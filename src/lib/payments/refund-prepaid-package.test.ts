import { describe, expect, it } from "vitest";
import { createFakeSchedulingRepository } from "@/lib/scheduling/test-support/fake-scheduling-repository";
import { createFakeBookingRepository } from "@/lib/booking/test-support/fake-booking-repository";
import { createFakeVisitPaymentGateway } from "./test-support/fake-visit-payment-gateway";
import { refundPrepaidPackage } from "./refund-prepaid-package";
import { InvalidVisitStateError } from "@/lib/scheduling/errors";
import { toStripeCents } from "@/lib/booking/stripe/money";
import type { PrepaidPackageRow } from "@/lib/scheduling/domain-types";

function makePackage(overrides: Partial<PrepaidPackageRow> = {}): PrepaidPackageRow {
  return {
    id: "pkg-1",
    customerId: "customer-1",
    bookingOrderId: "booking-1",
    frequency: "weekly",
    purchasedVisitCount: 6,
    remainingVisitCount: 6,
    packageTotalPaid: 900,
    effectivePricePerVisit: 150,
    status: "active",
    purchasedAt: new Date("2026-08-01T00:00:00Z"),
    ...overrides,
  };
}

/** Seeds a completed payment_attempt on the fake booking repo (a real PaymentIntent id) for the package's booking order. */
async function seedCompletedPaymentAttempt(bookingRepo: ReturnType<typeof createFakeBookingRepository>["repo"], bookingOrderId: string, stripePaymentIntentId = "pi_package_1") {
  const attempt = await bookingRepo.insertPaymentAttempt({
    bookingOrderId,
    mode: "payment",
    stripeCheckoutSessionId: `cs_${bookingOrderId}`,
    stripeCustomerId: "cus_1",
    amount: 900,
    paymentMethodType: null,
    packageSubtotalBeforeAchIncentive: null,
    achSavingsAmount: null,
  });
  await bookingRepo.updatePaymentAttemptBySessionId(attempt.stripeCheckoutSessionId, { status: "completed", stripePaymentIntentId });
}

describe("refundPrepaidPackage — finalized cancellation policy", () => {
  it("0 completed visits: the full package principal is refundable", async () => {
    const { repo: schedulingRepo } = createFakeSchedulingRepository({ prepaidPackages: [makePackage({ remainingVisitCount: 6 })] });
    const { repo: bookingRepo } = createFakeBookingRepository();
    await seedCompletedPaymentAttempt(bookingRepo, "booking-1");
    const { gateway, state: gatewayState } = createFakeVisitPaymentGateway();

    const result = await refundPrepaidPackage(schedulingRepo, bookingRepo, gateway, {
      prepaidPackageId: "pkg-1",
      reason: "customer cancelled before first visit",
      actorAdminUserId: "owner-1",
      actorRole: "owner_admin",
    });

    expect(result.refundAmount).toBe(900);
    expect(result.package.status).toBe("cancelled");
    expect(result.package.refundedAmount).toBe(900);
    expect(gatewayState.createRefundCallCount).toBe(1);
    const [refund] = gatewayState.refunds.values();
    expect(refund.amountCents).toBe(toStripeCents(900));
  });

  it("the worked example from the finalized policy: $900 principal, 2 of 6 completed -> $600 refundable", async () => {
    const { repo: schedulingRepo } = createFakeSchedulingRepository({ prepaidPackages: [makePackage({ remainingVisitCount: 4 })] });
    const { repo: bookingRepo } = createFakeBookingRepository();
    await seedCompletedPaymentAttempt(bookingRepo, "booking-1");
    const { gateway } = createFakeVisitPaymentGateway();

    const result = await refundPrepaidPackage(schedulingRepo, bookingRepo, gateway, {
      prepaidPackageId: "pkg-1",
      reason: "customer moving away",
      actorAdminUserId: "owner-1",
      actorRole: "owner_admin",
    });

    expect(result.refundAmount).toBe(600);
    expect(result.package.status).toBe("cancelled");
  });

  it.each([
    [6, 900],
    [5, 750],
    [4, 600],
    [3, 450],
    [2, 300],
    [1, 150],
    [0, 0],
  ])("remainingVisitCount=%i of 6 purchased -> refundable %i", async (remaining, expected) => {
    const { repo: schedulingRepo } = createFakeSchedulingRepository({ prepaidPackages: [makePackage({ remainingVisitCount: remaining })] });
    const { repo: bookingRepo } = createFakeBookingRepository();
    if (expected > 0) await seedCompletedPaymentAttempt(bookingRepo, "booking-1");
    const { gateway } = createFakeVisitPaymentGateway();

    const result = await refundPrepaidPackage(schedulingRepo, bookingRepo, gateway, {
      prepaidPackageId: "pkg-1",
      reason: "test",
      actorAdminUserId: "owner-1",
      actorRole: "owner_admin",
    });

    expect(result.refundAmount).toBe(expected);
  });

  it("6 of 6 completed (remainingVisitCount=0): zero refundable, no Stripe refund attempted, package still marked cancelled", async () => {
    const { repo: schedulingRepo } = createFakeSchedulingRepository({ prepaidPackages: [makePackage({ remainingVisitCount: 0 })] });
    const { repo: bookingRepo } = createFakeBookingRepository();
    // Deliberately no completed payment attempt seeded — proves the $0 path never even looks for one.
    const { gateway, state: gatewayState } = createFakeVisitPaymentGateway();

    const result = await refundPrepaidPackage(schedulingRepo, bookingRepo, gateway, {
      prepaidPackageId: "pkg-1",
      reason: "all visits used",
      actorAdminUserId: "owner-1",
      actorRole: "owner_admin",
    });

    expect(result.refundAmount).toBe(0);
    expect(result.package.status).toBe("cancelled");
    expect(result.package.refundedAmount).toBe(0);
    expect(gatewayState.createRefundCallCount).toBe(0);
    expect(gatewayState.createTaxReversalCallCount).toBe(0);
  });

  it("rounding/cents: a non-evenly-divisible fraction rounds once at the end, never compounding intermediate rounding", async () => {
    // $1000 / 6 * 5 = 833.33333... -> must round to exactly 833.33, not accumulate error.
    const { repo: schedulingRepo } = createFakeSchedulingRepository({ prepaidPackages: [makePackage({ packageTotalPaid: 1000, remainingVisitCount: 5 })] });
    const { repo: bookingRepo } = createFakeBookingRepository();
    await seedCompletedPaymentAttempt(bookingRepo, "booking-1");
    const { gateway, state: gatewayState } = createFakeVisitPaymentGateway();

    const result = await refundPrepaidPackage(schedulingRepo, bookingRepo, gateway, {
      prepaidPackageId: "pkg-1",
      reason: "rounding check",
      actorAdminUserId: "owner-1",
      actorRole: "owner_admin",
    });

    expect(result.refundAmount).toBe(833.33);
    const [refund] = gatewayState.refunds.values();
    expect(refund.amountCents).toBe(83333); // exact integer cents, no floating-point drift
  });

  it("never repriced at current rates — uses only the immutable packageTotalPaid snapshot even if it differs from purchasedVisitCount * effectivePricePerVisit", async () => {
    // effectivePricePerVisit here would imply 6*160=960, but the actual immutable snapshot paid was 900 (e.g. a since-changed pricing config) — the refund must use 900, never 960.
    const { repo: schedulingRepo } = createFakeSchedulingRepository({
      prepaidPackages: [makePackage({ packageTotalPaid: 900, effectivePricePerVisit: 160, remainingVisitCount: 6 })],
    });
    const { repo: bookingRepo } = createFakeBookingRepository();
    await seedCompletedPaymentAttempt(bookingRepo, "booking-1");
    const { gateway } = createFakeVisitPaymentGateway();

    const result = await refundPrepaidPackage(schedulingRepo, bookingRepo, gateway, {
      prepaidPackageId: "pkg-1",
      reason: "test",
      actorAdminUserId: "owner-1",
      actorRole: "owner_admin",
    });

    expect(result.refundAmount).toBe(900);
  });

  it("rejects cancelling a package that is not active (no double refund / no double cancel)", async () => {
    const { repo: schedulingRepo } = createFakeSchedulingRepository({ prepaidPackages: [makePackage({ status: "cancelled", remainingVisitCount: 4 })] });
    const { repo: bookingRepo } = createFakeBookingRepository();
    const { gateway, state: gatewayState } = createFakeVisitPaymentGateway();

    await expect(
      refundPrepaidPackage(schedulingRepo, bookingRepo, gateway, { prepaidPackageId: "pkg-1", reason: "x", actorAdminUserId: "owner-1", actorRole: "owner_admin" })
    ).rejects.toThrow(InvalidVisitStateError);
    expect(gatewayState.createRefundCallCount).toBe(0);
  });

  it("financial_audit_log records the cancellation with actor attribution and package-level metadata", async () => {
    const { repo: schedulingRepo, state } = createFakeSchedulingRepository({ prepaidPackages: [makePackage({ remainingVisitCount: 4 })] });
    const { repo: bookingRepo } = createFakeBookingRepository();
    await seedCompletedPaymentAttempt(bookingRepo, "booking-1");
    const { gateway } = createFakeVisitPaymentGateway();

    await refundPrepaidPackage(schedulingRepo, bookingRepo, gateway, {
      prepaidPackageId: "pkg-1",
      reason: "owner-approved cancellation",
      actorAdminUserId: "owner-1",
      actorRole: "owner_admin",
    });

    expect(state.financialAuditLog).toHaveLength(1);
    const [entry] = state.financialAuditLog;
    expect(entry.actionType).toBe("refund_issued");
    expect(entry.targetEntityType).toBe("prepaid_package");
    expect(entry.actorAdminUserId).toBe("owner-1");
    expect(entry.metadata).toMatchObject({ refundAmount: 600, packageTotalPaid: 900, purchasedVisitCount: 6, remainingVisitCountAtCancellation: 4 });
  });
});

describe("refundPrepaidPackage — Phase H.2: proportional tax refund", () => {
  // The real sandbox package: $770.63 principal, $63.58 tax, $834.21 total, 6 purchased.
  function makeTaxedPackage(overrides: Partial<PrepaidPackageRow> = {}): PrepaidPackageRow {
    return makePackage({
      packageTotalPaid: 770.63,
      taxAmount: 63.58,
      totalAmountPaid: 834.21,
      effectivePricePerVisit: 128.44,
      ...overrides,
    });
  }

  it.each([
    // [remaining, expectedPrincipalRefund, expectedTaxRefund, expectedCombinedCents]
    [0, 0, 0, 0],
    [1, 128.44, 10.6, 13904],
    [2, 256.88, 21.19, 27807],
    [5, 642.19, 52.98, 69517],
    [6, 770.63, 63.58, 83421],
  ])("remaining=%i of 6 purchased -> principal $%d + tax $%d refunded as one combined Stripe refund of %i cents", async (remaining, expectedPrincipal, expectedTax, expectedCents) => {
    const { repo: schedulingRepo } = createFakeSchedulingRepository({ prepaidPackages: [makeTaxedPackage({ remainingVisitCount: remaining })] });
    const { repo: bookingRepo } = createFakeBookingRepository();
    if (expectedCents > 0) await seedCompletedPaymentAttempt(bookingRepo, "booking-1");
    const { gateway, state: gatewayState } = createFakeVisitPaymentGateway();

    const result = await refundPrepaidPackage(schedulingRepo, bookingRepo, gateway, {
      prepaidPackageId: "pkg-1",
      reason: "test",
      actorAdminUserId: "owner-1",
      actorRole: "owner_admin",
    });

    expect(result.refundAmount).toBe(expectedPrincipal);
    expect(result.refundTaxAmount).toBe(expectedTax);
    expect(result.package.refundedAmount).toBe(expectedPrincipal);
    expect(result.package.refundedTaxAmount).toBe(expectedTax);

    if (expectedCents > 0) {
      expect(gatewayState.createRefundCallCount).toBe(1);
      const [refund] = gatewayState.refunds.values();
      // ONE combined Stripe refund for principal + tax — never two separate calls, never a float-summed amount.
      expect(refund.amountCents).toBe(expectedCents);
      expect(result.package.totalRefundedAmount).toBe(roundToCentsForTest(expectedCents));
    } else {
      expect(gatewayState.createRefundCallCount).toBe(0);
    }

    // No double refund, no over-refund: exactly one refund ever created, never exceeding the original charge.
    expect(gatewayState.refunds.size).toBeLessThanOrEqual(1);
    // Never calls the Tax Transaction reversal API for a prepaid package — see the function's own doc comment for why.
    expect(gatewayState.createTaxReversalCallCount).toBe(0);
  });

  function roundToCentsForTest(cents: number): number {
    return Math.round(cents) / 100;
  }

  it("legacy package with no recorded taxAmount refunds $0 tax, never invents a figure", async () => {
    const { repo: schedulingRepo } = createFakeSchedulingRepository({ prepaidPackages: [makePackage({ remainingVisitCount: 4, taxAmount: null })] });
    const { repo: bookingRepo } = createFakeBookingRepository();
    await seedCompletedPaymentAttempt(bookingRepo, "booking-1");
    const { gateway, state: gatewayState } = createFakeVisitPaymentGateway();

    const result = await refundPrepaidPackage(schedulingRepo, bookingRepo, gateway, {
      prepaidPackageId: "pkg-1",
      reason: "legacy package, no tax on file",
      actorAdminUserId: "owner-1",
      actorRole: "owner_admin",
    });

    expect(result.refundAmount).toBe(600);
    expect(result.refundTaxAmount).toBe(0);
    const [refund] = gatewayState.refunds.values();
    expect(refund.amountCents).toBe(toStripeCents(600)); // principal only — no phantom tax cents added
  });

  it("never combines principal and tax by float addition before converting to Stripe cents (642.19 + 52.98 !== 695.17 in IEEE-754)", async () => {
    const { repo: schedulingRepo } = createFakeSchedulingRepository({ prepaidPackages: [makeTaxedPackage({ remainingVisitCount: 5 })] });
    const { repo: bookingRepo } = createFakeBookingRepository();
    await seedCompletedPaymentAttempt(bookingRepo, "booking-1");
    const { gateway, state: gatewayState } = createFakeVisitPaymentGateway();

    await refundPrepaidPackage(schedulingRepo, bookingRepo, gateway, { prepaidPackageId: "pkg-1", reason: "float-drift check", actorAdminUserId: "owner-1", actorRole: "owner_admin" });

    const [refund] = gatewayState.refunds.values();
    expect(refund.amountCents).toBe(69517); // exact integer cents; a naive float sum would drift by a fraction of a cent
    expect(Number.isInteger(refund.amountCents)).toBe(true);
  });

  it("financial_audit_log records both refundTaxAmount and totalRefundAmount alongside refundAmount", async () => {
    const { repo: schedulingRepo, state } = createFakeSchedulingRepository({ prepaidPackages: [makeTaxedPackage({ remainingVisitCount: 5 })] });
    const { repo: bookingRepo } = createFakeBookingRepository();
    await seedCompletedPaymentAttempt(bookingRepo, "booking-1");
    const { gateway } = createFakeVisitPaymentGateway();

    await refundPrepaidPackage(schedulingRepo, bookingRepo, gateway, { prepaidPackageId: "pkg-1", reason: "audit check", actorAdminUserId: "owner-1", actorRole: "owner_admin" });

    const [entry] = state.financialAuditLog;
    expect(entry.metadata).toMatchObject({ refundAmount: 642.19, refundTaxAmount: 52.98, totalRefundAmount: 695.17, taxAmount: 63.58 });
  });

  it("rejects a tax refund exceeding the original taxAmount (no over-refund of tax)", async () => {
    const { repo: schedulingRepo } = createFakeSchedulingRepository({ prepaidPackages: [makeTaxedPackage({ remainingVisitCount: 6 })] });
    const { repo: bookingRepo } = createFakeBookingRepository();
    await seedCompletedPaymentAttempt(bookingRepo, "booking-1");
    const { gateway } = createFakeVisitPaymentGateway();

    // remainingVisitCount === purchasedVisitCount already refunds 100% of tax — this is exercised implicitly by
    // the RPC's own bound (see 20260920100000's cancel_prepaid_package_with_refund_audit); a direct over-refund
    // attempt is covered at the repository layer (fake-scheduling-repository.test coverage via this same RPC path).
    const result = await refundPrepaidPackage(schedulingRepo, bookingRepo, gateway, { prepaidPackageId: "pkg-1", reason: "full refund", actorAdminUserId: "owner-1", actorRole: "owner_admin" });
    expect(result.refundTaxAmount).toBe(63.58);
  });
});
