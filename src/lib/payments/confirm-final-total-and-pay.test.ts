import { describe, expect, it } from "vitest";
import type { NewServiceVisitRow } from "@/lib/scheduling/domain-types";
import { createFakeSchedulingRepository } from "@/lib/scheduling/test-support/fake-scheduling-repository";
import { createFakeBookingRepository } from "@/lib/booking/test-support/fake-booking-repository";
import { createFakeVisitPaymentGateway } from "./test-support/fake-visit-payment-gateway";
import { confirmFinalTotalAndPay } from "./confirm-final-total-and-pay";
import { InvalidVisitStateError } from "@/lib/scheduling/errors";

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

const CUSTOMER_WITH_CARD = {
  "customer-1": {
    id: "customer-1",
    name: "Jane",
    email: "jane@example.com",
    phone: null,
    stripeCustomerId: "cus_1",
    stripeDefaultPaymentMethodId: "pm_1",
    stripePaymentMethodBrand: "visa",
    stripePaymentMethodLast4: "4242",
  },
};

async function markCompleted(state: ReturnType<typeof createFakeSchedulingRepository>["state"], visitId: string) {
  const current = state.serviceVisitsById.get(visitId);
  state.serviceVisitsById.set(visitId, { ...current!, status: "completed" });
}

async function seedConfirmedVisit(
  schedulingRepo: ReturnType<typeof createFakeSchedulingRepository>["repo"],
  state: ReturnType<typeof createFakeSchedulingRepository>["state"],
  amount: number,
  completed: boolean
) {
  const visit = await schedulingRepo.insertServiceVisit(NEW_VISIT);
  await schedulingRepo.upsertServiceVisitPricing({
    serviceVisitId: visit.id,
    pricingVersion: "v1",
    pricingSnapshot: {},
    baseAmount: amount,
    addOnIds: [],
    addOnAmount: 0,
    totalAmount: amount,
    amountDueFromCustomer: amount,
    priceStatus: "estimated",
    requiresCustomerApproval: false,
    previouslyApprovedAmount: null,
  });
  await schedulingRepo.confirmServiceVisitPricing(visit.id, "admin:1");
  if (completed) await markCompleted(state, visit.id);
  return visit;
}

/** A visit whose pricing was confirmed AHEAD of the cleaning (e.g. via confirmVisitPricingAction, the recurring pre-cleaning confirm tool) — 'confirmed' but not yet 'completed'. */
async function seedConfirmedButNotCompletedVisit(
  schedulingRepo: ReturnType<typeof createFakeSchedulingRepository>["repo"],
  amount: number
) {
  const visit = await schedulingRepo.insertServiceVisit(NEW_VISIT);
  await schedulingRepo.upsertServiceVisitPricing({
    serviceVisitId: visit.id,
    pricingVersion: "v1",
    pricingSnapshot: {},
    baseAmount: amount,
    addOnIds: [],
    addOnAmount: 0,
    totalAmount: amount,
    amountDueFromCustomer: amount,
    priceStatus: "estimated",
    requiresCustomerApproval: false,
    previouslyApprovedAmount: null,
  });
  await schedulingRepo.confirmServiceVisitPricing(visit.id, "admin:1");
  return visit;
}

/** A legacy row still carrying a 'pending_customer_approval' price_status from before the 2026-09-26 product decision retired that gate — never produced by any current code path, but the row shape must still be handled safely (rejected, not silently auto-resolved). */
async function seedLegacyPendingApprovalRow(schedulingRepo: ReturnType<typeof createFakeSchedulingRepository>["repo"], amount: number) {
  const visit = await schedulingRepo.insertServiceVisit(NEW_VISIT);
  await schedulingRepo.upsertServiceVisitPricing({
    serviceVisitId: visit.id,
    pricingVersion: "v1",
    pricingSnapshot: {},
    baseAmount: amount,
    addOnIds: [],
    addOnAmount: 0,
    totalAmount: amount,
    amountDueFromCustomer: amount,
    priceStatus: "pending_customer_approval",
    requiresCustomerApproval: true,
    previouslyApprovedAmount: amount - 30,
  });
  return visit;
}

describe("confirmFinalTotalAndPay", () => {
  it("normal case: confirmed pricing on a completed visit pays the exact total in one call", async () => {
    const { repo: schedulingRepo, state } = createFakeSchedulingRepository();
    const { repo: bookingRepo } = createFakeBookingRepository({ customers: CUSTOMER_WITH_CARD });
    const { gateway } = createFakeVisitPaymentGateway({ taxRateBps: 1000 });
    const visit = await seedConfirmedVisit(schedulingRepo, state, 200, true);

    const outcome = await confirmFinalTotalAndPay(schedulingRepo, bookingRepo, gateway, {
      serviceVisitId: visit.id,
      customerId: "customer-1",
      tipSelectionType: "percentage_15",
    });

    expect(outcome.outcome).toBe("ready");
    const payment = await schedulingRepo.findServiceVisitPaymentByVisitId(visit.id);
    expect(payment?.tipAmount).toBe(30); // 15% of 200
    expect(payment?.totalAmount).toBe(253); // (200 + 30) * 1.10
  });

  it("requires a tip selection before paying on a completed visit", async () => {
    const { repo: schedulingRepo, state } = createFakeSchedulingRepository();
    const { repo: bookingRepo } = createFakeBookingRepository({ customers: CUSTOMER_WITH_CARD });
    const { gateway } = createFakeVisitPaymentGateway();
    const visit = await seedConfirmedVisit(schedulingRepo, state, 200, true);

    await expect(
      confirmFinalTotalAndPay(schedulingRepo, bookingRepo, gateway, { serviceVisitId: visit.id, customerId: "customer-1" })
    ).rejects.toThrow(InvalidVisitStateError);
  });

  it("a visit confirmed ahead of the cleaning (not yet completed) returns approved_awaiting_completion, with no tip/payment attempted", async () => {
    const { repo: schedulingRepo, state } = createFakeSchedulingRepository();
    const { repo: bookingRepo } = createFakeBookingRepository({ customers: CUSTOMER_WITH_CARD });
    const { gateway } = createFakeVisitPaymentGateway();
    const visit = await seedConfirmedButNotCompletedVisit(schedulingRepo, 200);

    const outcome = await confirmFinalTotalAndPay(schedulingRepo, bookingRepo, gateway, {
      serviceVisitId: visit.id,
      customerId: "customer-1",
    });

    expect(outcome).toEqual({ outcome: "approved_awaiting_completion" });

    const payment = await schedulingRepo.findServiceVisitPaymentByVisitId(visit.id);
    expect(payment).toBeNull();
    expect(state.serviceVisitsById.get(visit.id)?.status).not.toBe("completed");
  });

  it("Finalize & Send flow: a work_finished (not yet completed) visit is completed, tipped, and paid in the customer's ONE call", async () => {
    const { repo: schedulingRepo, state } = createFakeSchedulingRepository();
    const { repo: bookingRepo } = createFakeBookingRepository({ customers: CUSTOMER_WITH_CARD });
    const { gateway } = createFakeVisitPaymentGateway({ taxRateBps: 0 });
    const visit = await seedConfirmedButNotCompletedVisit(schedulingRepo, 230);
    // work_finished, not completed — Finalize & Send always confirms pricing
    // and would normally complete the visit itself; this simulates the
    // narrow edge case where pricing was confirmed ahead of time (see
    // seedConfirmedButNotCompletedVisit) and the visit is only now marked
    // work-finished, so this call is what crosses to 'completed'.
    const current = state.serviceVisitsById.get(visit.id)!;
    state.serviceVisitsById.set(visit.id, { ...current, status: "work_finished", workFinishedAt: new Date() });

    const outcome = await confirmFinalTotalAndPay(schedulingRepo, bookingRepo, gateway, {
      serviceVisitId: visit.id,
      customerId: "customer-1",
      tipSelectionType: "percentage_20",
    });

    expect(outcome.outcome).toBe("ready");
    expect(state.serviceVisitsById.get(visit.id)?.status).toBe("completed");
    const payment = await schedulingRepo.findServiceVisitPaymentByVisitId(visit.id);
    expect(payment?.approvedAmount).toBe(230);
    expect(payment?.tipAmount).toBe(46); // 20% of 230
    expect(payment?.totalAmount).toBe(276); // 230 + 46, 0% tax
  });

  it("repeated confirmation on a work_finished visit cannot double-charge — the second call reuses the same PaymentIntent", async () => {
    const { repo: schedulingRepo, state } = createFakeSchedulingRepository();
    const { repo: bookingRepo } = createFakeBookingRepository({ customers: CUSTOMER_WITH_CARD });
    const { gateway, state: gatewayState } = createFakeVisitPaymentGateway({ taxRateBps: 0 });
    const visit = await seedConfirmedButNotCompletedVisit(schedulingRepo, 230);
    const current = state.serviceVisitsById.get(visit.id)!;
    state.serviceVisitsById.set(visit.id, { ...current, status: "work_finished", workFinishedAt: new Date() });

    const first = await confirmFinalTotalAndPay(schedulingRepo, bookingRepo, gateway, {
      serviceVisitId: visit.id,
      customerId: "customer-1",
      tipSelectionType: "percentage_20",
    });
    const second = await confirmFinalTotalAndPay(schedulingRepo, bookingRepo, gateway, {
      serviceVisitId: visit.id,
      customerId: "customer-1",
      tipSelectionType: "percentage_20",
    });

    expect(first.outcome).toBe("ready");
    expect(second.outcome).toBe("ready");
    if (first.outcome === "ready" && second.outcome === "ready") {
      expect(second.clientSecret).toBe(first.clientSecret);
    }
    expect(gatewayState.createPaymentIntentCallCount).toBe(1);
  });

  it("rejects (rather than silently auto-resolving) a legacy row still carrying a pending_customer_approval price_status — that gate is retired, never auto-bypassed", async () => {
    const { repo: schedulingRepo } = createFakeSchedulingRepository();
    const { repo: bookingRepo } = createFakeBookingRepository({ customers: CUSTOMER_WITH_CARD });
    const { gateway } = createFakeVisitPaymentGateway();
    const visit = await seedLegacyPendingApprovalRow(schedulingRepo, 230);

    await expect(
      confirmFinalTotalAndPay(schedulingRepo, bookingRepo, gateway, { serviceVisitId: visit.id, customerId: "customer-1" })
    ).rejects.toThrow(InvalidVisitStateError);

    const payment = await schedulingRepo.findServiceVisitPaymentByVisitId(visit.id);
    expect(payment).toBeNull();
  });
});
