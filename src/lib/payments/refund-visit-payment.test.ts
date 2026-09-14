import { describe, expect, it } from "vitest";
import { createFakeSchedulingRepository } from "@/lib/scheduling/test-support/fake-scheduling-repository";
import { createFakeBookingRepository } from "@/lib/booking/test-support/fake-booking-repository";
import { createFakeVisitPaymentGateway } from "./test-support/fake-visit-payment-gateway";
import { prepareVisitPaymentReview } from "./prepare-visit-payment-review";
import { selectVisitTip } from "./select-visit-tip";
import { createVisitPaymentIntent } from "./create-visit-payment-intent";
import { reconcileVisitPayment } from "./reconcile-visit-payment";
import { refundVisitPayment } from "./refund-visit-payment";
import { InvalidVisitStateError } from "@/lib/scheduling/errors";
import { toStripeCents } from "@/lib/booking/stripe/money";
import type { NewServiceVisitRow } from "@/lib/scheduling/domain-types";

const NEW_VISIT: NewServiceVisitRow = {
  customerId: "customer-1",
  quoteRequestId: null,
  bookingOrderId: null,
  prepaidPackageId: null,
  recurringScheduleId: null,
  visitNumber: null,
  cleaningType: "standard",
  frequency: "one_time",
  requestedStartAt: new Date(),
  timezone: "America/Chicago",
  serviceAddressLine1: "123 Main St",
  serviceAddressLine2: null,
  serviceCity: "Frisco",
  serviceState: "TX",
  serviceAddressIdentity: "75056|123 MAIN ST|",
};

/** A fully paid stripe_card visit, optionally with a committed Stripe Tax transaction, ready for refund testing. */
async function seedPaidVisit(options: { withCommittedTax?: boolean } = {}) {
  const { repo: schedulingRepo, state } = createFakeSchedulingRepository();
  const visit = await schedulingRepo.insertServiceVisit(NEW_VISIT);
  await schedulingRepo.upsertServiceVisitPricing({
    serviceVisitId: visit.id,
    pricingVersion: "v1",
    pricingSnapshot: {},
    baseAmount: 179,
    addOnIds: [],
    addOnAmount: 0,
    totalAmount: 179,
    amountDueFromCustomer: 179,
    priceStatus: "estimated",
    requiresCustomerApproval: false,
    previouslyApprovedAmount: null,
  });
  await schedulingRepo.confirmServiceVisitPricing(visit.id, "admin:1");
  state.serviceVisitsById.set(visit.id, { ...(await schedulingRepo.findServiceVisitById(visit.id))!, status: "completed" });

  const { gateway, state: gatewayState } = createFakeVisitPaymentGateway();
  await prepareVisitPaymentReview(schedulingRepo, gateway, visit.id);
  await selectVisitTip(schedulingRepo, gateway, { serviceVisitId: visit.id, tipSelectionType: "percentage_15" });

  const { repo: bookingRepo } = createFakeBookingRepository({
    customers: { "customer-1": { id: "customer-1", name: "Jane", email: "jane@example.com", phone: null, stripeCustomerId: "cus_1", stripeDefaultPaymentMethodId: "pm_1", stripePaymentMethodBrand: "visa", stripePaymentMethodLast4: "4242" } },
  });
  const outcome = await createVisitPaymentIntent(schedulingRepo, bookingRepo, gateway, { serviceVisitId: visit.id, customerId: "customer-1" });
  if (outcome.outcome !== "ready") throw new Error("expected ready");

  let payment = (await schedulingRepo.findServiceVisitPaymentByVisitId(visit.id))!;
  if (options.withCommittedTax) {
    gatewayState.taxAssociationByPaymentIntentId.set(payment.stripePaymentIntentId!, { committedTransactionId: "txn_original", erroredReason: null });
  }
  await reconcileVisitPayment(schedulingRepo, gateway, { stripePaymentIntentId: payment.stripePaymentIntentId!, status: "paid" });
  payment = (await schedulingRepo.findServiceVisitPaymentByVisitId(visit.id))!;

  return { schedulingRepo, schedulingState: state, gateway, gatewayState, visitId: visit.id, payment };
}

describe("refundVisitPayment", () => {
  it("full refund: issues a Stripe refund for the exact amount, marks the row refunded, and records a financial_audit_log entry", async () => {
    const { schedulingRepo, gateway, gatewayState, visitId, payment } = await seedPaidVisit();

    const updated = await refundVisitPayment(schedulingRepo, gateway, {
      serviceVisitId: visitId,
      refundAmount: payment.totalAmount!,
      reason: "Customer requested cancellation",
      actorAdminUserId: "owner-1",
      actorRole: "owner_admin",
    });

    expect(updated.status).toBe("refunded");
    expect(updated.refundedAmount).toBeCloseTo(payment.totalAmount!, 2);
    expect(gatewayState.createRefundCallCount).toBe(1);
    const [refund] = gatewayState.refunds.values();
    expect(refund.stripePaymentIntentId).toBe(payment.stripePaymentIntentId);
    expect(refund.amountCents).toBe(toStripeCents(payment.totalAmount!));

    const pricing = await schedulingRepo.findServiceVisitPricingByVisitId(visitId);
    expect(pricing!.paymentStatus).toBe("refunded");
  });

  it("financial_audit_log records the refund with actor attribution", async () => {
    const { schedulingRepo, schedulingState, gateway, visitId, payment } = await seedPaidVisit();

    await refundVisitPayment(schedulingRepo, gateway, {
      serviceVisitId: visitId,
      refundAmount: payment.totalAmount!,
      reason: "Owner-approved cancellation",
      actorAdminUserId: "owner-1",
      actorRole: "owner_admin",
    });

    expect(schedulingState.financialAuditLog).toHaveLength(1);
    const [entry] = schedulingState.financialAuditLog;
    expect(entry.actorAdminUserId).toBe("owner-1");
    expect(entry.actorRole).toBe("owner_admin");
    expect(entry.actionType).toBe("refund_issued");
    expect(entry.targetEntityType).toBe("service_visit_payment");
    expect(entry.serviceVisitId).toBe(visitId);
    expect(entry.reason).toBe("Owner-approved cancellation");
    expect(entry.metadata).toMatchObject({ refundAmount: payment.totalAmount, newStatus: "refunded" });
  });

  it("partial refund: leaves the row partially_refunded and preserves the remaining refundable balance", async () => {
    const { schedulingRepo, gateway, visitId, payment } = await seedPaidVisit();
    const half = Math.round((payment.totalAmount! / 2) * 100) / 100;

    const updated = await refundVisitPayment(schedulingRepo, gateway, {
      serviceVisitId: visitId,
      refundAmount: half,
      reason: "Partial goodwill refund",
      actorAdminUserId: "owner-1",
      actorRole: "owner_admin",
    });

    expect(updated.status).toBe("partially_refunded");
    expect(updated.refundedAmount).toBeCloseTo(half, 2);
  });

  it("a second partial refund progresses partially_refunded -> refunded once the remaining balance is refunded", async () => {
    const { schedulingRepo, gateway, visitId, payment } = await seedPaidVisit();
    const half = Math.round((payment.totalAmount! / 2) * 100) / 100;
    await refundVisitPayment(schedulingRepo, gateway, { serviceVisitId: visitId, refundAmount: half, reason: "first", actorAdminUserId: "owner-1", actorRole: "owner_admin" });

    const updated = await refundVisitPayment(schedulingRepo, gateway, {
      serviceVisitId: visitId,
      refundAmount: payment.totalAmount! - half,
      reason: "second, remainder",
      actorAdminUserId: "owner-1",
      actorRole: "owner_admin",
    });

    expect(updated.status).toBe("refunded");
    expect(updated.refundedAmount).toBeCloseTo(payment.totalAmount!, 2);
  });

  it("rejects a refund amount exceeding the remaining refundable balance — no over-refund", async () => {
    const { schedulingRepo, gateway, visitId, payment, gatewayState } = await seedPaidVisit();

    await expect(
      refundVisitPayment(schedulingRepo, gateway, {
        serviceVisitId: visitId,
        refundAmount: payment.totalAmount! + 50,
        reason: "too much",
        actorAdminUserId: "owner-1",
        actorRole: "owner_admin",
      })
    ).rejects.toThrow(InvalidVisitStateError);
    expect(gatewayState.createRefundCallCount).toBe(0); // rejected before ever calling Stripe
  });

  it("rejects refunding a row that is not paid/partially_refunded (terminal-state protection preserved from Phase A)", async () => {
    const { repo: schedulingRepo, state } = createFakeSchedulingRepository();
    const visit = await schedulingRepo.insertServiceVisit(NEW_VISIT);
    await schedulingRepo.upsertServiceVisitPricing({
      serviceVisitId: visit.id,
      pricingVersion: "v1",
      pricingSnapshot: {},
      baseAmount: 179,
      addOnIds: [],
      addOnAmount: 0,
      totalAmount: 179,
      amountDueFromCustomer: 179,
      priceStatus: "estimated",
      requiresCustomerApproval: false,
      previouslyApprovedAmount: null,
    });
    state.serviceVisitsById.set(visit.id, { ...(await schedulingRepo.findServiceVisitById(visit.id))!, status: "completed" });
    await schedulingRepo.confirmServiceVisitPricing(visit.id, "admin:1");
    const { gateway } = createFakeVisitPaymentGateway();
    await prepareVisitPaymentReview(schedulingRepo, gateway, visit.id);
    // Row exists but tip never selected/frozen — status is "created", not paid.

    await expect(
      refundVisitPayment(schedulingRepo, gateway, { serviceVisitId: visit.id, refundAmount: 50, reason: "x", actorAdminUserId: "owner-1", actorRole: "owner_admin" })
    ).rejects.toThrow(InvalidVisitStateError);
  });

  it("rejects a second refund once the row is already fully refunded (terminal state)", async () => {
    const { schedulingRepo, gateway, visitId, payment, gatewayState } = await seedPaidVisit();
    await refundVisitPayment(schedulingRepo, gateway, { serviceVisitId: visitId, refundAmount: payment.totalAmount!, reason: "full", actorAdminUserId: "owner-1", actorRole: "owner_admin" });

    await expect(
      refundVisitPayment(schedulingRepo, gateway, { serviceVisitId: visitId, refundAmount: 1, reason: "double refund attempt", actorAdminUserId: "owner-1", actorRole: "owner_admin" })
    ).rejects.toThrow(InvalidVisitStateError);
    expect(gatewayState.createRefundCallCount).toBe(1); // the rejected attempt never reached Stripe again
  });

  it("has no Stripe refund path for an external (zelle/cash) settlement — rejected with a clear error, not silently attempted", async () => {
    const { repo: schedulingRepo, state } = createFakeSchedulingRepository();
    const visit = await schedulingRepo.insertServiceVisit(NEW_VISIT);
    await schedulingRepo.upsertServiceVisitPricing({
      serviceVisitId: visit.id,
      pricingVersion: "v1",
      pricingSnapshot: {},
      baseAmount: 179,
      addOnIds: [],
      addOnAmount: 0,
      totalAmount: 179,
      amountDueFromCustomer: 179,
      priceStatus: "estimated",
      requiresCustomerApproval: false,
      previouslyApprovedAmount: null,
    });
    state.serviceVisitsById.set(visit.id, { ...(await schedulingRepo.findServiceVisitById(visit.id))!, status: "completed" });
    await schedulingRepo.confirmServiceVisitPricing(visit.id, "admin:1");
    const { gateway } = createFakeVisitPaymentGateway();
    await prepareVisitPaymentReview(schedulingRepo, gateway, visit.id);
    await selectVisitTip(schedulingRepo, gateway, { serviceVisitId: visit.id, tipSelectionType: "percentage_15" });
    const { recordExternalPayment } = await import("./record-external-payment");
    await recordExternalPayment(schedulingRepo, gateway, { serviceVisitId: visit.id, paymentMethodType: "cash", externalPaymentReference: null, actorAdminUserId: "admin-1", actorRole: "admin" });

    await expect(
      refundVisitPayment(schedulingRepo, gateway, { serviceVisitId: visit.id, refundAmount: 50, reason: "x", actorAdminUserId: "owner-1", actorRole: "owner_admin" })
    ).rejects.toThrow(InvalidVisitStateError);
  });
});

describe("refundVisitPayment — Phase F: Stripe Tax reversal", () => {
  it("full refund with a committed Stripe Tax transaction triggers a full-mode reversal", async () => {
    const { schedulingRepo, gateway, gatewayState, visitId, payment } = await seedPaidVisit({ withCommittedTax: true });

    await refundVisitPayment(schedulingRepo, gateway, {
      serviceVisitId: visitId,
      refundAmount: payment.totalAmount!,
      reason: "full refund with tax",
      actorAdminUserId: "owner-1",
      actorRole: "owner_admin",
    });

    expect(gatewayState.createTaxReversalCallCount).toBe(1);
    const [reversal] = gatewayState.taxReversals.values();
    expect(reversal.originalTransactionId).toBe("txn_original");
    expect(reversal.mode).toBe("full");
    expect(reversal.refundAmountCents).toBeUndefined();
  });

  it("partial refund with a committed Stripe Tax transaction triggers a partial-mode reversal for exactly the refunded amount", async () => {
    const { schedulingRepo, gateway, gatewayState, visitId, payment } = await seedPaidVisit({ withCommittedTax: true });
    const half = Math.round((payment.totalAmount! / 2) * 100) / 100;

    await refundVisitPayment(schedulingRepo, gateway, {
      serviceVisitId: visitId,
      refundAmount: half,
      reason: "partial refund with tax",
      actorAdminUserId: "owner-1",
      actorRole: "owner_admin",
    });

    expect(gatewayState.createTaxReversalCallCount).toBe(1);
    const [reversal] = gatewayState.taxReversals.values();
    expect(reversal.mode).toBe("partial");
    expect(reversal.refundAmountCents).toBe(toStripeCents(half));
  });

  it("skips tax reversal deterministically (no error) when the original payment has no committed Stripe Tax transaction", async () => {
    const { schedulingRepo, gateway, gatewayState, visitId, payment } = await seedPaidVisit({ withCommittedTax: false });

    const updated = await refundVisitPayment(schedulingRepo, gateway, {
      serviceVisitId: visitId,
      refundAmount: payment.totalAmount!,
      reason: "no tax on file",
      actorAdminUserId: "owner-1",
      actorRole: "owner_admin",
    });

    expect(updated.status).toBe("refunded"); // the refund itself still succeeds
    expect(gatewayState.createTaxReversalCallCount).toBe(0);
  });

  it("a failed tax reversal never rolls back or blocks the already-committed refund", async () => {
    const { schedulingRepo, gateway, gatewayState, visitId, payment } = await seedPaidVisit({ withCommittedTax: true });
    gatewayState.taxReversals.clear();
    (gateway as unknown as { reverseTaxTransaction: () => Promise<never> }).reverseTaxTransaction = () => {
      throw new Error("simulated Stripe Tax outage");
    };

    const updated = await refundVisitPayment(schedulingRepo, gateway, {
      serviceVisitId: visitId,
      refundAmount: payment.totalAmount!,
      reason: "refund despite tax outage",
      actorAdminUserId: "owner-1",
      actorRole: "owner_admin",
    });

    expect(updated.status).toBe("refunded");
    expect(updated.refundedAmount).toBeCloseTo(payment.totalAmount!, 2);
  });
});
