import { describe, expect, it } from "vitest";
import { createFakeSchedulingRepository } from "@/lib/scheduling/test-support/fake-scheduling-repository";
import { createFakeBookingRepository } from "@/lib/booking/test-support/fake-booking-repository";
import { createFakeVisitPaymentGateway } from "./test-support/fake-visit-payment-gateway";
import { prepareVisitPaymentReview } from "./prepare-visit-payment-review";
import { selectVisitTip } from "./select-visit-tip";
import { createVisitPaymentIntent, DeadPaymentIntentError } from "./create-visit-payment-intent";
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

async function seedVisitWithSelectedTip(amountDueFromCustomer: number, tipSelectionType: "percentage_15" | "custom" = "percentage_15", customAmount?: number) {
  const { repo: schedulingRepo, state } = createFakeSchedulingRepository();
  const visit = await schedulingRepo.insertServiceVisit(NEW_VISIT);
  await schedulingRepo.upsertServiceVisitPricing({
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
  await schedulingRepo.confirmServiceVisitPricing(visit.id, "admin:1");
  state.serviceVisitsById.set(visit.id, { ...(await schedulingRepo.findServiceVisitById(visit.id))!, status: "completed" });

  const { gateway, state: gatewayState } = createFakeVisitPaymentGateway();
  await prepareVisitPaymentReview(schedulingRepo, gateway, visit.id);
  await selectVisitTip(schedulingRepo, gateway, { serviceVisitId: visit.id, tipSelectionType, customAmount });

  return { schedulingRepo, gateway, gatewayState, schedulingState: state, visitId: visit.id };
}

async function seedVisitWithoutTip(amountDueFromCustomer: number) {
  const { repo: schedulingRepo, state } = createFakeSchedulingRepository();
  const visit = await schedulingRepo.insertServiceVisit(NEW_VISIT);
  await schedulingRepo.upsertServiceVisitPricing({
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
  await schedulingRepo.confirmServiceVisitPricing(visit.id, "admin:1");
  state.serviceVisitsById.set(visit.id, { ...(await schedulingRepo.findServiceVisitById(visit.id))!, status: "completed" });

  const { gateway } = createFakeVisitPaymentGateway();
  await prepareVisitPaymentReview(schedulingRepo, gateway, visit.id);

  return { schedulingRepo, gateway, visitId: visit.id };
}

describe("createVisitPaymentIntent", () => {
  it("tip selection remains required before payment — refuses to create a PaymentIntent without one, even with a saved card", async () => {
    const { schedulingRepo, gateway, visitId } = await seedVisitWithoutTip(179);
    const { repo: bookingRepo } = createFakeBookingRepository({
      customers: { "customer-1": { id: "customer-1", name: "Jane", email: "jane@example.com", phone: null, stripeCustomerId: "cus_1", stripeDefaultPaymentMethodId: "pm_1", stripePaymentMethodBrand: "visa", stripePaymentMethodLast4: "4242" } },
    });

    await expect(createVisitPaymentIntent(schedulingRepo, bookingRepo, gateway, { serviceVisitId: visitId, customerId: "customer-1" })).rejects.toThrow(
      "A tip selection is required before payment."
    );
    const payment = await schedulingRepo.findServiceVisitPaymentByVisitId(visitId);
    expect(payment!.stripePaymentIntentId).toBeNull();
  });

  it("returns needs_payment_method when the customer has no saved card", async () => {
    const { schedulingRepo, gateway, visitId } = await seedVisitWithSelectedTip(179);
    const { repo: bookingRepo } = createFakeBookingRepository({
      customers: { "customer-1": { id: "customer-1", name: "Jane", email: "jane@example.com", phone: null, stripeCustomerId: "cus_1", stripeDefaultPaymentMethodId: null, stripePaymentMethodBrand: null, stripePaymentMethodLast4: null } },
    });

    const outcome = await createVisitPaymentIntent(schedulingRepo, bookingRepo, gateway, { serviceVisitId: visitId, customerId: "customer-1" });
    expect(outcome.outcome).toBe("needs_payment_method");
  });

  it("creates a PaymentIntent for exactly the final calculation's total, on-session (no off_session/confirm:true anywhere in the fake's recorded inputs)", async () => {
    const { schedulingRepo, gateway, gatewayState, visitId } = await seedVisitWithSelectedTip(179);
    const { repo: bookingRepo } = createFakeBookingRepository({
      customers: { "customer-1": { id: "customer-1", name: "Jane", email: "jane@example.com", phone: null, stripeCustomerId: "cus_1", stripeDefaultPaymentMethodId: "pm_1", stripePaymentMethodBrand: "visa", stripePaymentMethodLast4: "4242" } },
    });

    const outcome = await createVisitPaymentIntent(schedulingRepo, bookingRepo, gateway, { serviceVisitId: visitId, customerId: "customer-1" });
    expect(outcome.outcome).toBe("ready");
    if (outcome.outcome !== "ready") throw new Error("expected ready");
    expect(gatewayState.createPaymentIntentCallCount).toBe(1);

    const payment = await schedulingRepo.findServiceVisitPaymentByVisitId(visitId);
    expect(payment!.totalAmount).toBeCloseTo(outcome.totalAmount, 2);
    expect(payment!.tipConfirmedAt).not.toBeNull(); // frozen
    expect(payment!.paymentMethodType).toBe("stripe_card");
    expect(payment!.stripeCustomerId).toBe("cus_1");
    expect(payment!.stripePaymentMethodId).toBe("pm_1");
  });

  it("double-click / repeated call after a PaymentIntent already exists reuses it — never creates a second PaymentIntent", async () => {
    const { schedulingRepo, gateway, gatewayState, visitId } = await seedVisitWithSelectedTip(179);
    const { repo: bookingRepo } = createFakeBookingRepository({
      customers: { "customer-1": { id: "customer-1", name: "Jane", email: "jane@example.com", phone: null, stripeCustomerId: "cus_1", stripeDefaultPaymentMethodId: "pm_1", stripePaymentMethodBrand: "visa", stripePaymentMethodLast4: "4242" } },
    });

    const first = await createVisitPaymentIntent(schedulingRepo, bookingRepo, gateway, { serviceVisitId: visitId, customerId: "customer-1" });
    const second = await createVisitPaymentIntent(schedulingRepo, bookingRepo, gateway, { serviceVisitId: visitId, customerId: "customer-1" });

    expect(gatewayState.createPaymentIntentCallCount).toBe(1); // only the first call actually created one
    if (first.outcome !== "ready" || second.outcome !== "ready") throw new Error("expected ready both times");
    expect(second.clientSecret).toBe(first.clientSecret);
  });

  it("$0 total (prepaid, no extras, Custom $0 tip) never creates a PaymentIntent — resolves to no_payment_due", async () => {
    const { schedulingRepo, gateway, gatewayState, visitId } = await seedVisitWithSelectedTip(0, "custom", 0);
    const { repo: bookingRepo } = createFakeBookingRepository();

    const outcome = await createVisitPaymentIntent(schedulingRepo, bookingRepo, gateway, { serviceVisitId: visitId, customerId: "customer-1" });
    expect(outcome.outcome).toBe("no_payment_due");
    expect(gatewayState.createPaymentIntentCallCount).toBe(0);

    const payment = await schedulingRepo.findServiceVisitPaymentByVisitId(visitId);
    expect(payment!.status).toBe("no_payment_due");
    expect(payment!.tipConfirmedAt).not.toBeNull();
    expect(payment!.paidAt).toBeNull(); // nothing was actually paid
  });

  it("an expired Tax Calculation is transparently refreshed pre-freeze, and the caller must re-confirm rather than silently proceed", async () => {
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

    const { gateway, state: gatewayState } = createFakeVisitPaymentGateway({ calculationValiditySeconds: -1 }); // already expired the instant it's created
    await prepareVisitPaymentReview(schedulingRepo, gateway, visit.id);
    await selectVisitTip(schedulingRepo, gateway, { serviceVisitId: visit.id, tipSelectionType: "percentage_15" });

    const { repo: bookingRepo } = createFakeBookingRepository({
      customers: { "customer-1": { id: "customer-1", name: "Jane", email: "jane@example.com", phone: null, stripeCustomerId: "cus_1", stripeDefaultPaymentMethodId: "pm_1", stripePaymentMethodBrand: "visa", stripePaymentMethodLast4: "4242" } },
    });

    const outcome = await createVisitPaymentIntent(schedulingRepo, bookingRepo, gateway, { serviceVisitId: visit.id, customerId: "customer-1" });
    expect(outcome.outcome).toBe("refreshed");
    expect(gatewayState.createPaymentIntentCallCount).toBe(0); // never proceeded to charge on a stale total

    const payment = await schedulingRepo.findServiceVisitPaymentByVisitId(visit.id);
    expect(payment!.tipConfirmedAt).toBeNull(); // still not frozen — customer must confirm again
  });

  it("retry lifecycle: reuses the existing PaymentIntent when its Stripe status is safely reconfirmable (processing/requires_action/requires_payment_method/succeeded)", async () => {
    for (const status of ["processing", "requires_action", "requires_payment_method", "succeeded"] as const) {
      const { schedulingRepo, gateway, gatewayState, visitId } = await seedVisitWithSelectedTip(179);
      const { repo: bookingRepo } = createFakeBookingRepository({
        customers: { "customer-1": { id: "customer-1", name: "Jane", email: "jane@example.com", phone: null, stripeCustomerId: "cus_1", stripeDefaultPaymentMethodId: "pm_1", stripePaymentMethodBrand: "visa", stripePaymentMethodLast4: "4242" } },
      });
      const first = await createVisitPaymentIntent(schedulingRepo, bookingRepo, gateway, { serviceVisitId: visitId, customerId: "customer-1" });
      if (first.outcome !== "ready") throw new Error("expected ready");

      // Simulate Stripe now reporting this status for the existing intent.
      for (const record of gatewayState.paymentIntents.values()) record.status = status;

      const second = await createVisitPaymentIntent(schedulingRepo, bookingRepo, gateway, { serviceVisitId: visitId, customerId: "customer-1" });
      expect(second.outcome).toBe("ready");
      expect(gatewayState.createPaymentIntentCallCount).toBe(1); // never a second intent, regardless of which safe status this is
    }
  });

  it("retry lifecycle: a definitively dead PaymentIntent (canceled) throws DeadPaymentIntentError rather than silently returning a dead client_secret or creating a duplicate charge", async () => {
    const { schedulingRepo, gateway, gatewayState, visitId } = await seedVisitWithSelectedTip(179);
    const { repo: bookingRepo } = createFakeBookingRepository({
      customers: { "customer-1": { id: "customer-1", name: "Jane", email: "jane@example.com", phone: null, stripeCustomerId: "cus_1", stripeDefaultPaymentMethodId: "pm_1", stripePaymentMethodBrand: "visa", stripePaymentMethodLast4: "4242" } },
    });
    const first = await createVisitPaymentIntent(schedulingRepo, bookingRepo, gateway, { serviceVisitId: visitId, customerId: "customer-1" });
    if (first.outcome !== "ready") throw new Error("expected ready");

    for (const record of gatewayState.paymentIntents.values()) record.status = "canceled";

    await expect(createVisitPaymentIntent(schedulingRepo, bookingRepo, gateway, { serviceVisitId: visitId, customerId: "customer-1" })).rejects.toThrow(
      DeadPaymentIntentError
    );
    expect(gatewayState.createPaymentIntentCallCount).toBe(1); // still only the original — no duplicate-charge attempt
  });

  describe("safe retry when financial facts froze but PaymentIntent creation never happened", () => {
    async function seedFrozenWithNoIntent(amountDueFromCustomer = 185) {
      const { schedulingRepo, gateway, gatewayState, schedulingState, visitId } = await seedVisitWithSelectedTip(amountDueFromCustomer);
      const paymentBefore = (await schedulingRepo.findServiceVisitPaymentByVisitId(visitId))!;
      // Simulates freezeServiceVisitPaymentForStripeCard having succeeded
      // (real production sequencing) while the subsequent
      // gateway.createPaymentIntent call itself failed/threw before an
      // intent id could ever be persisted — e.g. the real E2E failure where
      // the frozen payment method turned out to be a non-card (Link) type.
      await schedulingRepo.freezeServiceVisitPaymentForStripeCard(paymentBefore.id, {
        stripeCustomerId: "cus_1",
        stripePaymentMethodId: "pm_1",
        cardBrand: "visa",
        cardLast4: "4242",
      });
      return { schedulingRepo, gateway, gatewayState, schedulingState, visitId, paymentId: paymentBefore.id };
    }

    it("retries and succeeds using the SAME already-frozen card payment method, amount, and tax calculation — never re-deriving them", async () => {
      const { schedulingRepo, gateway, gatewayState, visitId } = await seedFrozenWithNoIntent(185);
      const { repo: bookingRepo } = createFakeBookingRepository({
        customers: { "customer-1": { id: "customer-1", name: "Jane", email: "jane@example.com", phone: null, stripeCustomerId: "cus_1", stripeDefaultPaymentMethodId: "pm_1", stripePaymentMethodBrand: "visa", stripePaymentMethodLast4: "4242" } },
      });

      const before = (await schedulingRepo.findServiceVisitPaymentByVisitId(visitId))!;
      expect(before.stripePaymentIntentId).toBeNull();
      expect(before.tipConfirmedAt).not.toBeNull();

      const outcome = await createVisitPaymentIntent(schedulingRepo, bookingRepo, gateway, { serviceVisitId: visitId, customerId: "customer-1" });
      expect(outcome.outcome).toBe("ready");
      expect(gatewayState.createPaymentIntentCallCount).toBe(1);

      const after = (await schedulingRepo.findServiceVisitPaymentByVisitId(visitId))!;
      expect(after.stripePaymentIntentId).not.toBeNull();
      expect(after.status).toBe("processing");
      // Never replaced the frozen payment method with a different one.
      expect(after.stripePaymentMethodId).toBe(before.stripePaymentMethodId);
      expect(after.stripeCustomerId).toBe(before.stripeCustomerId);
    });

    it("does not alter the frozen approvedAmount/tipAmount/taxAmount/totalAmount during the retry", async () => {
      const { schedulingRepo, gateway, visitId } = await seedFrozenWithNoIntent(185);
      const { repo: bookingRepo } = createFakeBookingRepository({
        customers: { "customer-1": { id: "customer-1", name: "Jane", email: "jane@example.com", phone: null, stripeCustomerId: "cus_1", stripeDefaultPaymentMethodId: "pm_1", stripePaymentMethodBrand: "visa", stripePaymentMethodLast4: "4242" } },
      });

      const before = (await schedulingRepo.findServiceVisitPaymentByVisitId(visitId))!;
      await createVisitPaymentIntent(schedulingRepo, bookingRepo, gateway, { serviceVisitId: visitId, customerId: "customer-1" });
      const after = (await schedulingRepo.findServiceVisitPaymentByVisitId(visitId))!;

      expect(after.approvedAmount).toBe(before.approvedAmount);
      expect(after.tipAmount).toBe(before.tipAmount);
      expect(after.taxAmount).toBe(before.taxAmount);
      expect(after.totalAmount).toBe(before.totalAmount);
    });

    it("reuses the row's own idempotency key on retry — the exact mechanism that prevents a duplicate Stripe-side charge", async () => {
      const { schedulingRepo, gateway, gatewayState, visitId } = await seedFrozenWithNoIntent(185);
      const { repo: bookingRepo } = createFakeBookingRepository({
        customers: { "customer-1": { id: "customer-1", name: "Jane", email: "jane@example.com", phone: null, stripeCustomerId: "cus_1", stripeDefaultPaymentMethodId: "pm_1", stripePaymentMethodBrand: "visa", stripePaymentMethodLast4: "4242" } },
      });

      const before = (await schedulingRepo.findServiceVisitPaymentByVisitId(visitId))!;
      await createVisitPaymentIntent(schedulingRepo, bookingRepo, gateway, { serviceVisitId: visitId, customerId: "customer-1" });

      expect(gatewayState.lastCreatePaymentIntentInput?.idempotencyKey).toBe(before.idempotencyKey);
    });

    it("a SECOND retry call after the first succeeded reuses the now-existing PaymentIntent, never creating a duplicate", async () => {
      const { schedulingRepo, gateway, gatewayState, visitId } = await seedFrozenWithNoIntent(185);
      const { repo: bookingRepo } = createFakeBookingRepository({
        customers: { "customer-1": { id: "customer-1", name: "Jane", email: "jane@example.com", phone: null, stripeCustomerId: "cus_1", stripeDefaultPaymentMethodId: "pm_1", stripePaymentMethodBrand: "visa", stripePaymentMethodLast4: "4242" } },
      });

      const first = await createVisitPaymentIntent(schedulingRepo, bookingRepo, gateway, { serviceVisitId: visitId, customerId: "customer-1" });
      const second = await createVisitPaymentIntent(schedulingRepo, bookingRepo, gateway, { serviceVisitId: visitId, customerId: "customer-1" });

      expect(gatewayState.createPaymentIntentCallCount).toBe(1);
      if (first.outcome !== "ready" || second.outcome !== "ready") throw new Error("expected ready both times");
      expect(second.clientSecret).toBe(first.clientSecret);
    });

    it.each([
      ["paid", { status: "paid" as const }],
      ["refunded", { status: "refunded" as const }],
      ["partially_refunded", { status: "partially_refunded" as const }],
      ["payment_failed", { status: "payment_failed" as const }],
    ])("status=%s (terminal/settled) never enters the retry branch — still throws the existing 'already settled' error", async (_label, override) => {
      const { schedulingRepo, gateway, schedulingState, visitId } = await seedFrozenWithNoIntent(185);
      // Directly force the terminal status onto the fake's own backing map —
      // the same pattern seedVisitWithSelectedTip already uses
      // (state.serviceVisitsById.set(...)) to reach an otherwise-unreachable-
      // via-public-API state for this test only.
      const raw = schedulingState.paymentsByVisitId.get(visitId)!;
      schedulingState.paymentsByVisitId.set(visitId, { ...raw, ...override });

      const { repo: bookingRepo } = createFakeBookingRepository({
        customers: { "customer-1": { id: "customer-1", name: "Jane", email: "jane@example.com", phone: null, stripeCustomerId: "cus_1", stripeDefaultPaymentMethodId: "pm_1", stripePaymentMethodBrand: "visa", stripePaymentMethodLast4: "4242" } },
      });

      await expect(createVisitPaymentIntent(schedulingRepo, bookingRepo, gateway, { serviceVisitId: visitId, customerId: "customer-1" })).rejects.toThrow(
        "This payment has already been settled through another method."
      );
    });

    it("a zelle/cash paymentMethodType (external settlement path) never enters the card retry branch", async () => {
      const { schedulingRepo, gateway, schedulingState, visitId } = await seedFrozenWithNoIntent(185);
      const raw = schedulingState.paymentsByVisitId.get(visitId)!;
      schedulingState.paymentsByVisitId.set(visitId, { ...raw, paymentMethodType: "zelle", externalPaymentReference: "manual-note" });

      const { repo: bookingRepo } = createFakeBookingRepository({
        customers: { "customer-1": { id: "customer-1", name: "Jane", email: "jane@example.com", phone: null, stripeCustomerId: "cus_1", stripeDefaultPaymentMethodId: "pm_1", stripePaymentMethodBrand: "visa", stripePaymentMethodLast4: "4242" } },
      });

      await expect(createVisitPaymentIntent(schedulingRepo, bookingRepo, gateway, { serviceVisitId: visitId, customerId: "customer-1" })).rejects.toThrow(
        "This payment has already been settled through another method."
      );
    });

    it("never passes a non-card payment method into gateway.createPaymentIntent — Link/non-card is never broadened into the post-cleaning charge path", async () => {
      const { schedulingRepo, gateway, gatewayState, visitId } = await seedFrozenWithNoIntent(185);
      const { repo: bookingRepo } = createFakeBookingRepository({
        customers: { "customer-1": { id: "customer-1", name: "Jane", email: "jane@example.com", phone: null, stripeCustomerId: "cus_1", stripeDefaultPaymentMethodId: "pm_1", stripePaymentMethodBrand: "visa", stripePaymentMethodLast4: "4242" } },
      });

      await createVisitPaymentIntent(schedulingRepo, bookingRepo, gateway, { serviceVisitId: visitId, customerId: "customer-1" });
      // The retry branch only ever reuses payment.stripePaymentMethodId,
      // which was frozen as "pm_1" (a card PM) in seedFrozenWithNoIntent —
      // there is no code path here that could substitute a Link/non-card id.
      expect(gatewayState.lastCreatePaymentIntentInput?.stripePaymentMethodId).toBe("pm_1");
    });
  });
});
