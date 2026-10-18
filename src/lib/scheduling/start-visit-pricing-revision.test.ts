import { describe, expect, it } from "vitest";
import { createFakeSchedulingRepository } from "./test-support/fake-scheduling-repository";
import { createFakeVisitPaymentGateway } from "@/lib/payments/test-support/fake-visit-payment-gateway";
import { prepareVisitPaymentReview } from "@/lib/payments/prepare-visit-payment-review";
import { selectVisitTip } from "@/lib/payments/select-visit-tip";
import { InvalidVisitStateError } from "./errors";
import { startVisitPricingRevision } from "./start-visit-pricing-revision";
import type { NewServiceVisitRow } from "./domain-types";

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

async function seedCompletedConfirmedVisit(amountDueFromCustomer = 179) {
  const { repo, state } = createFakeSchedulingRepository();
  const visit = await repo.insertServiceVisit(NEW_VISIT);
  await repo.upsertServiceVisitPricing({
    serviceVisitId: visit.id,
    pricingVersion: "v1",
    pricingSnapshot: {},
    baseAmount: amountDueFromCustomer,
    addOnIds: [],
    addOnAmount: 0,
    totalAmount: amountDueFromCustomer,
    amountDueFromCustomer,
    priceStatus: "estimated",
    requiresCustomerApproval: false,
    previouslyApprovedAmount: null,
  });
  await repo.confirmServiceVisitPricing(visit.id, "admin:1");
  state.serviceVisitsById.set(visit.id, { ...(await repo.findServiceVisitById(visit.id))!, status: "completed" });
  return { repo, state, visitId: visit.id };
}

const ACTOR = { actorAdminUserId: "admin-1", actorRole: "owner_admin", reason: "customer requested a scope change" };

describe("startVisitPricingRevision", () => {
  it("not completed: refuses and makes no changes", async () => {
    const { repo, state, visitId } = await seedCompletedConfirmedVisit();
    state.serviceVisitsById.set(visitId, { ...(await repo.findServiceVisitById(visitId))!, status: "work_finished" });
    const { gateway } = createFakeVisitPaymentGateway();

    await expect(startVisitPricingRevision(repo, gateway, { serviceVisitId: visitId, ...ACTOR })).rejects.toThrow(InvalidVisitStateError);
  });

  it("happy path, no payment row yet: reopens pricing, increments revisionNumber, logs audit + event", async () => {
    const { repo, state, visitId } = await seedCompletedConfirmedVisit();
    const { gateway } = createFakeVisitPaymentGateway();

    const result = await startVisitPricingRevision(repo, gateway, { serviceVisitId: visitId, ...ACTOR });

    expect(result.priceStatus).toBe("revision_in_progress");
    expect(result.revisionNumber).toBe(1);
    expect(state.financialAuditLog).toHaveLength(1);
    expect(state.financialAuditLog[0].actionType).toBe("final_total_revision_started");
    expect(state.events.some((e) => e.eventType === "visit_pricing_revision_started")).toBe(true);
  });

  it("idempotent re-entry: calling again while already mid-revision is a genuine no-op — no second audit/event, no revisionNumber bump", async () => {
    const { repo, state, visitId } = await seedCompletedConfirmedVisit();
    const { gateway } = createFakeVisitPaymentGateway();

    const first = await startVisitPricingRevision(repo, gateway, { serviceVisitId: visitId, ...ACTOR });
    const second = await startVisitPricingRevision(repo, gateway, { serviceVisitId: visitId, ...ACTOR });

    expect(second.revisionNumber).toBe(first.revisionNumber);
    expect(state.financialAuditLog).toHaveLength(1); // not 2
    expect(state.events.filter((e) => e.eventType === "visit_pricing_revision_started")).toHaveLength(1);
  });

  it("already paid: refuses and points at Issue Refund, makes no changes", async () => {
    const { repo, visitId } = await seedCompletedConfirmedVisit();
    const { gateway } = createFakeVisitPaymentGateway();
    await prepareVisitPaymentReview(repo, gateway, visitId);
    await selectVisitTip(repo, gateway, { serviceVisitId: visitId, tipSelectionType: "percentage_15" });
    const payment = (await repo.findServiceVisitPaymentByVisitId(visitId))!;
    await repo.recordExternalServiceVisitPaymentWithAudit(
      payment.id,
      { paymentMethodType: "cash", externalPaymentReference: null },
      { actorAdminUserId: "admin-0", actorRole: "owner_admin" }
    );

    await expect(startVisitPricingRevision(repo, gateway, { serviceVisitId: visitId, ...ACTOR })).rejects.toThrow("Issue Refund");
    const pricing = await repo.findServiceVisitPricingByVisitId(visitId);
    expect(pricing!.priceStatus).toBe("confirmed"); // untouched
  });

  it("resets an existing, not-yet-paid payment row's tip/tax/total/Stripe fields back to a fresh, unselected state", async () => {
    const { repo, visitId } = await seedCompletedConfirmedVisit();
    const { gateway } = createFakeVisitPaymentGateway();
    await prepareVisitPaymentReview(repo, gateway, visitId);
    await selectVisitTip(repo, gateway, { serviceVisitId: visitId, tipSelectionType: "percentage_15" });

    await startVisitPricingRevision(repo, gateway, { serviceVisitId: visitId, ...ACTOR });

    const payment = await repo.findServiceVisitPaymentByVisitId(visitId);
    expect(payment!.status).toBe("created");
    expect(payment!.tipSelectionType).toBeNull();
    expect(payment!.tipAmount).toBeNull();
    expect(payment!.totalAmount).toBeNull();
    expect(payment!.tipConfirmedAt).toBeNull();
    expect(payment!.stripePaymentIntentId).toBeNull();
  });

  it("a live succeeded PaymentIntent hard-aborts with zero writes and never attempts a cancel", async () => {
    const { repo, visitId } = await seedCompletedConfirmedVisit();
    const { gateway, state: gatewayState } = createFakeVisitPaymentGateway({ nextPaymentIntentStatus: "requires_confirmation" });
    await prepareVisitPaymentReview(repo, gateway, visitId);
    await selectVisitTip(repo, gateway, { serviceVisitId: visitId, tipSelectionType: "percentage_15" });
    const claim = await repo.claimVisitPaymentAttempt({
      serviceVisitId: visitId,
      stripeCustomerId: "cus_1",
      stripePaymentMethodId: "pm_1",
      cardBrand: "visa",
      cardLast4: "4242",
    });
    if (!claim.ok) throw new Error("expected claim to succeed");
    const intent = await gateway.createPaymentIntent({
      stripeCustomerId: "cus_1",
      stripePaymentMethodId: "pm_1",
      amountCents: 10000,
      stripeTaxCalculationId: claim.record.stripeTaxCalculationId!,
      metadata: {},
      idempotencyKey: claim.record.idempotencyKey,
    });
    await repo.setServiceVisitPaymentIntent(claim.record.id, { stripePaymentIntentId: intent.id, status: "processing" });
    for (const record of gatewayState.paymentIntents.values()) record.status = "succeeded";

    await expect(startVisitPricingRevision(repo, gateway, { serviceVisitId: visitId, ...ACTOR })).rejects.toThrow("just succeeded");
    expect(gatewayState.cancelPaymentIntentCallCount).toBe(0);
    const pricing = await repo.findServiceVisitPricingByVisitId(visitId);
    expect(pricing!.priceStatus).toBe("confirmed"); // untouched
  });

  it("a live processing PaymentIntent hard-aborts with zero writes and never attempts a cancel", async () => {
    const { repo, visitId } = await seedCompletedConfirmedVisit();
    const { gateway, state: gatewayState } = createFakeVisitPaymentGateway();
    await prepareVisitPaymentReview(repo, gateway, visitId);
    await selectVisitTip(repo, gateway, { serviceVisitId: visitId, tipSelectionType: "percentage_15" });
    const claim = await repo.claimVisitPaymentAttempt({
      serviceVisitId: visitId,
      stripeCustomerId: "cus_1",
      stripePaymentMethodId: "pm_1",
      cardBrand: "visa",
      cardLast4: "4242",
    });
    if (!claim.ok) throw new Error("expected claim to succeed");
    const intent = await gateway.createPaymentIntent({
      stripeCustomerId: "cus_1",
      stripePaymentMethodId: "pm_1",
      amountCents: 10000,
      stripeTaxCalculationId: claim.record.stripeTaxCalculationId!,
      metadata: {},
      idempotencyKey: claim.record.idempotencyKey,
    });
    await repo.setServiceVisitPaymentIntent(claim.record.id, { stripePaymentIntentId: intent.id, status: "processing" });
    for (const record of gatewayState.paymentIntents.values()) record.status = "processing";

    await expect(startVisitPricingRevision(repo, gateway, { serviceVisitId: visitId, ...ACTOR })).rejects.toThrow("actively processing");
    expect(gatewayState.cancelPaymentIntentCallCount).toBe(0);
  });

  it("a cancelable live PaymentIntent (requires_payment_method) is cancelled, then the revision proceeds", async () => {
    const { repo, visitId } = await seedCompletedConfirmedVisit();
    const { gateway, state: gatewayState } = createFakeVisitPaymentGateway({ nextPaymentIntentStatus: "requires_payment_method" });
    await prepareVisitPaymentReview(repo, gateway, visitId);
    await selectVisitTip(repo, gateway, { serviceVisitId: visitId, tipSelectionType: "percentage_15" });
    const claim = await repo.claimVisitPaymentAttempt({
      serviceVisitId: visitId,
      stripeCustomerId: "cus_1",
      stripePaymentMethodId: "pm_1",
      cardBrand: "visa",
      cardLast4: "4242",
    });
    if (!claim.ok) throw new Error("expected claim to succeed");
    const intent = await gateway.createPaymentIntent({
      stripeCustomerId: "cus_1",
      stripePaymentMethodId: "pm_1",
      amountCents: 10000,
      stripeTaxCalculationId: claim.record.stripeTaxCalculationId!,
      metadata: {},
      idempotencyKey: claim.record.idempotencyKey,
    });
    await repo.setServiceVisitPaymentIntent(claim.record.id, { stripePaymentIntentId: intent.id, status: "processing" });

    const result = await startVisitPricingRevision(repo, gateway, { serviceVisitId: visitId, ...ACTOR });

    expect(gatewayState.cancelPaymentIntentCallCount).toBe(1);
    expect(result.priceStatus).toBe("revision_in_progress");
    const payment = await repo.findServiceVisitPaymentByVisitId(visitId);
    expect(payment!.stripePaymentIntentId).toBeNull();
  });

  it("an already-canceled intent is treated as 'no live intent' — proceeds without attempting another cancel", async () => {
    const { repo, visitId } = await seedCompletedConfirmedVisit();
    const { gateway, state: gatewayState } = createFakeVisitPaymentGateway();
    await prepareVisitPaymentReview(repo, gateway, visitId);
    await selectVisitTip(repo, gateway, { serviceVisitId: visitId, tipSelectionType: "percentage_15" });
    const claim = await repo.claimVisitPaymentAttempt({
      serviceVisitId: visitId,
      stripeCustomerId: "cus_1",
      stripePaymentMethodId: "pm_1",
      cardBrand: "visa",
      cardLast4: "4242",
    });
    if (!claim.ok) throw new Error("expected claim to succeed");
    const intent = await gateway.createPaymentIntent({
      stripeCustomerId: "cus_1",
      stripePaymentMethodId: "pm_1",
      amountCents: 10000,
      stripeTaxCalculationId: claim.record.stripeTaxCalculationId!,
      metadata: {},
      idempotencyKey: claim.record.idempotencyKey,
    });
    await repo.setServiceVisitPaymentIntent(claim.record.id, { stripePaymentIntentId: intent.id, status: "processing" });
    for (const record of gatewayState.paymentIntents.values()) record.status = "canceled";

    const result = await startVisitPricingRevision(repo, gateway, { serviceVisitId: visitId, ...ACTOR });

    expect(gatewayState.cancelPaymentIntentCallCount).toBe(0); // never re-cancels an already-dead intent
    expect(result.priceStatus).toBe("revision_in_progress");
  });

  it("no stripePaymentIntentId at all proceeds directly with no Stripe calls", async () => {
    const { repo, visitId } = await seedCompletedConfirmedVisit();
    const { gateway, state: gatewayState } = createFakeVisitPaymentGateway();
    await prepareVisitPaymentReview(repo, gateway, visitId);
    await selectVisitTip(repo, gateway, { serviceVisitId: visitId, tipSelectionType: "percentage_15" });

    const result = await startVisitPricingRevision(repo, gateway, { serviceVisitId: visitId, ...ACTOR });

    expect(gatewayState.cancelPaymentIntentCallCount).toBe(0);
    expect(result.priceStatus).toBe("revision_in_progress");
  });

  it("an unresolved in-flight claim (processing + null intent id) is always refused, with zero writes", async () => {
    const { repo, visitId } = await seedCompletedConfirmedVisit();
    const { gateway } = createFakeVisitPaymentGateway();
    await prepareVisitPaymentReview(repo, gateway, visitId);
    await selectVisitTip(repo, gateway, { serviceVisitId: visitId, tipSelectionType: "percentage_15" });
    const claim = await repo.claimVisitPaymentAttempt({
      serviceVisitId: visitId,
      stripeCustomerId: "cus_1",
      stripePaymentMethodId: "pm_1",
      cardBrand: "visa",
      cardLast4: "4242",
    });
    expect(claim.ok).toBe(true); // row is now status='processing', stripePaymentIntentId still null

    await expect(startVisitPricingRevision(repo, gateway, { serviceVisitId: visitId, ...ACTOR })).rejects.toThrow("in progress");
    const pricing = await repo.findServiceVisitPricingByVisitId(visitId);
    expect(pricing!.priceStatus).toBe("confirmed");
  });
});
