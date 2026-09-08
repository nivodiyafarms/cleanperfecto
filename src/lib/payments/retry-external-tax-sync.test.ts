import { describe, expect, it } from "vitest";
import { createFakeSchedulingRepository } from "@/lib/scheduling/test-support/fake-scheduling-repository";
import { createFakeVisitPaymentGateway } from "./test-support/fake-visit-payment-gateway";
import { InvalidVisitStateError } from "@/lib/scheduling/errors";
import { prepareVisitPaymentReview } from "./prepare-visit-payment-review";
import { selectVisitTip } from "./select-visit-tip";
import { recordExternalPayment } from "./record-external-payment";
import { retryExternalTaxSync } from "./retry-external-tax-sync";
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

async function seedExternallyPaidVisit(gatewayOptions: Parameters<typeof createFakeVisitPaymentGateway>[0] = {}) {
  const { repo, state } = createFakeSchedulingRepository();
  const visit = await repo.insertServiceVisit(NEW_VISIT);
  await repo.upsertServiceVisitPricing({
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
  await repo.confirmServiceVisitPricing(visit.id, "admin:1");
  state.serviceVisitsById.set(visit.id, { ...(await repo.findServiceVisitById(visit.id))!, status: "completed" });

  const { gateway, state: gatewayState } = createFakeVisitPaymentGateway(gatewayOptions);
  await prepareVisitPaymentReview(repo, gateway, visit.id);
  await selectVisitTip(repo, gateway, { serviceVisitId: visit.id, tipSelectionType: "percentage_15" });
  await recordExternalPayment(repo, createFakeVisitPaymentGateway({ failNextTaxTransactionCreate: true, ...gatewayOptions }).gateway, {
    serviceVisitId: visit.id,
    paymentMethodType: "cash",
    externalPaymentReference: null,
    actorAdminUserId: "admin-1",
    actorRole: "operations",
  }).catch(() => {});

  const payment = (await repo.findServiceVisitPaymentByVisitId(visit.id))!;
  return { repo, gateway, gatewayState, visitId: visit.id, paymentId: payment.id };
}

describe("retryExternalTaxSync", () => {
  it("refuses when the row is not paid", async () => {
    const { repo, state } = createFakeSchedulingRepository();
    const visit = await repo.insertServiceVisit(NEW_VISIT);
    await repo.upsertServiceVisitPricing({
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
    await repo.confirmServiceVisitPricing(visit.id, "admin:1");
    state.serviceVisitsById.set(visit.id, { ...(await repo.findServiceVisitById(visit.id))!, status: "completed" });
    const { gateway } = createFakeVisitPaymentGateway();
    const { record } = await repo.insertServiceVisitPaymentAttempt({ serviceVisitId: visit.id, serviceVisitPricingId: (await repo.findServiceVisitPricingByVisitId(visit.id))!.id, approvedAmount: 179, idempotencyKey: "k" });

    await expect(retryExternalTaxSync(repo, gateway, record.id)).rejects.toThrow(InvalidVisitStateError);
  });

  it("retries a failed external tax sync and successfully commits it — never duplicates the payment, never creates a second Tax Transaction on a later retry", async () => {
    const { repo, paymentId } = await seedExternallyPaidVisit();
    const before = await repo.findServiceVisitPaymentById(paymentId);
    expect(before!.taxTransactionStatus).toBe("failed"); // simulated failure during recordExternalPayment

    const workingGateway = createFakeVisitPaymentGateway();
    await retryExternalTaxSync(repo, workingGateway.gateway, paymentId);

    const after = await repo.findServiceVisitPaymentById(paymentId);
    expect(after!.taxTransactionStatus).toBe("committed");
    expect(after!.status).toBe("paid"); // payment fact untouched
    expect(after!.totalAmount).toBeCloseTo(before!.totalAmount!, 2);

    // A further retry is a safe idempotent no-op.
    await retryExternalTaxSync(repo, workingGateway.gateway, paymentId);
    expect(workingGateway.state.createTaxTransactionCallCount).toBe(1); // not called again once already committed
  });

  it("stripe_card rail retry only reconciles (tax.associations.find) — never calls createFromCalculation", async () => {
    const { repo, state } = createFakeSchedulingRepository();
    const visit = await repo.insertServiceVisit(NEW_VISIT);
    await repo.upsertServiceVisitPricing({
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
    await repo.confirmServiceVisitPricing(visit.id, "admin:1");
    state.serviceVisitsById.set(visit.id, { ...(await repo.findServiceVisitById(visit.id))!, status: "completed" });

    const pricing = (await repo.findServiceVisitPricingByVisitId(visit.id))!;
    const { record } = await repo.insertServiceVisitPaymentAttempt({ serviceVisitId: visit.id, serviceVisitPricingId: pricing.id, approvedAmount: 179, idempotencyKey: "k" });
    await repo.updateServiceVisitPaymentTip(record.id, {
      tipBasisAmount: 179,
      tipSelectionType: "percentage_15",
      tipPercentage: 15,
      tipAmount: 26.85,
      taxAmount: 10,
      totalAmount: 215.85,
      stripeTaxCalculationId: "taxcalc_1",
      taxCalculationExpiresAt: new Date(Date.now() + 60_000),
      taxLocationSnapshot: {},
    });
    const frozen = await repo.freezeServiceVisitPaymentForStripeCard(record.id, { stripeCustomerId: "cus_1", stripePaymentMethodId: "pm_1", cardBrand: "visa", cardLast4: "4242" });
    await repo.setServiceVisitPaymentIntent(frozen.id, { stripePaymentIntentId: "pi_1", status: "paid" });
    await repo.updateServiceVisitPaymentStatus(frozen.id, { status: "paid", paidAt: new Date() });
    await repo.updateServiceVisitPaymentTaxSync(frozen.id, { taxTransactionStatus: "pending" });

    const { gateway, state: gatewayState } = createFakeVisitPaymentGateway();
    gatewayState.taxAssociationByPaymentIntentId.set("pi_1", { committedTransactionId: "txn_card", erroredReason: null });

    await retryExternalTaxSync(repo, gateway, frozen.id);

    expect(gatewayState.createTaxTransactionCallCount).toBe(0);
    const after = await repo.findServiceVisitPaymentById(frozen.id);
    expect(after!.taxTransactionStatus).toBe("committed");
    expect(after!.stripeTaxTransactionId).toBe("txn_card");
  });

  it("expired external calculation with a matching recreated total syncs successfully without altering the paid total", async () => {
    const { repo, paymentId, gateway } = await seedExternallyPaidVisit({ calculationValiditySeconds: -1 });
    const before = await repo.findServiceVisitPaymentById(paymentId);

    await retryExternalTaxSync(repo, gateway, paymentId);

    const after = await repo.findServiceVisitPaymentById(paymentId);
    expect(after!.taxTransactionStatus).toBe("committed");
    expect(after!.totalAmount).toBeCloseTo(before!.totalAmount!, 2); // never changed
    expect(after!.status).toBe("paid");
  });

  it("expired external calculation with a MISMATCHED recreated total fails closed — never changes the paid total/status", async () => {
    const { repo, paymentId } = await seedExternallyPaidVisit({ calculationValiditySeconds: -1 });
    const mismatchedGateway = createFakeVisitPaymentGateway({ taxRateBps: 5000 }); // wildly different rate -> different total on recreate

    await retryExternalTaxSync(repo, mismatchedGateway.gateway, paymentId);

    const after = await repo.findServiceVisitPaymentById(paymentId);
    expect(after!.taxTransactionStatus).toBe("failed");
    expect(after!.taxTransactionFailureMessage).toMatch(/manual reconciliation required/i);
    expect(after!.status).toBe("paid"); // untouched
  });
});
