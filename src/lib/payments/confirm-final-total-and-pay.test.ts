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

async function seedPendingIncrease(
  schedulingRepo: ReturnType<typeof createFakeSchedulingRepository>["repo"],
  state: ReturnType<typeof createFakeSchedulingRepository>["state"],
  oldAmount: number,
  newAmount: number,
  completed: boolean
) {
  const visit = await schedulingRepo.insertServiceVisit(NEW_VISIT);
  await schedulingRepo.upsertServiceVisitPricing({
    serviceVisitId: visit.id,
    pricingVersion: "v1",
    pricingSnapshot: {},
    baseAmount: oldAmount,
    addOnIds: [],
    addOnAmount: 0,
    totalAmount: oldAmount,
    amountDueFromCustomer: oldAmount,
    priceStatus: "estimated",
    requiresCustomerApproval: false,
    previouslyApprovedAmount: null,
  });
  await schedulingRepo.confirmServiceVisitPricing(visit.id, "admin:1");
  await schedulingRepo.upsertServiceVisitPricing({
    serviceVisitId: visit.id,
    pricingVersion: "v1",
    pricingSnapshot: {},
    baseAmount: newAmount,
    addOnIds: ["inside_oven"],
    addOnAmount: 30,
    totalAmount: newAmount,
    amountDueFromCustomer: newAmount,
    priceStatus: "pending_customer_approval",
    requiresCustomerApproval: true,
    previouslyApprovedAmount: oldAmount,
  });
  if (completed) await markCompleted(state, visit.id);
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

  it("a pending increase on a NOT-yet-completed visit is approved in one call, with no tip/payment attempted", async () => {
    const { repo: schedulingRepo, state } = createFakeSchedulingRepository();
    const { repo: bookingRepo } = createFakeBookingRepository({ customers: CUSTOMER_WITH_CARD });
    const { gateway } = createFakeVisitPaymentGateway();
    const visit = await seedPendingIncrease(schedulingRepo, state, 200, 230, false);

    const outcome = await confirmFinalTotalAndPay(schedulingRepo, bookingRepo, gateway, {
      serviceVisitId: visit.id,
      customerId: "customer-1",
    });

    expect(outcome).toEqual({ outcome: "approved_awaiting_completion" });

    const pricing = await schedulingRepo.findServiceVisitPricingByVisitId(visit.id);
    expect(pricing?.priceStatus).toBe("confirmed");
    expect(pricing?.requiresCustomerApproval).toBe(false);
    expect(pricing?.previouslyApprovedAmount).toBe(230);
    expect(pricing?.confirmedBy).toBe("customer:customer-1");

    const payment = await schedulingRepo.findServiceVisitPaymentByVisitId(visit.id);
    expect(payment).toBeNull();
  });

  it("a pending increase on an ALREADY-completed visit is approved and paid in the same call (approve + confirm + tip + charge)", async () => {
    const { repo: schedulingRepo, state } = createFakeSchedulingRepository();
    const { repo: bookingRepo } = createFakeBookingRepository({ customers: CUSTOMER_WITH_CARD });
    const { gateway } = createFakeVisitPaymentGateway({ taxRateBps: 0 });
    const visit = await seedPendingIncrease(schedulingRepo, state, 200, 230, true);

    const outcome = await confirmFinalTotalAndPay(schedulingRepo, bookingRepo, gateway, {
      serviceVisitId: visit.id,
      customerId: "customer-1",
      tipSelectionType: "percentage_20",
    });

    expect(outcome.outcome).toBe("ready");
    const pricing = await schedulingRepo.findServiceVisitPricingByVisitId(visit.id);
    expect(pricing?.priceStatus).toBe("confirmed");
    expect(pricing?.confirmedBy).toBe("customer:customer-1");
    const payment = await schedulingRepo.findServiceVisitPaymentByVisitId(visit.id);
    expect(payment?.approvedAmount).toBe(230);
    expect(payment?.tipAmount).toBe(46); // 20% of 230
    expect(payment?.totalAmount).toBe(276); // 230 + 46, 0% tax
  });

  it("retrying after the approval step already succeeded does not re-approve or double-charge", async () => {
    const { repo: schedulingRepo, state } = createFakeSchedulingRepository();
    const { repo: bookingRepo } = createFakeBookingRepository({ customers: CUSTOMER_WITH_CARD });
    const { gateway, state: gatewayState } = createFakeVisitPaymentGateway({ taxRateBps: 0 });
    const visit = await seedPendingIncrease(schedulingRepo, state, 200, 230, true);

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

  it("Finalize & Send flow: a pending increase on a work_finished (not yet completed) visit is approved, completed, tipped, and paid in the customer's ONE call", async () => {
    const { repo: schedulingRepo, state } = createFakeSchedulingRepository();
    const { repo: bookingRepo } = createFakeBookingRepository({ customers: CUSTOMER_WITH_CARD });
    const { gateway } = createFakeVisitPaymentGateway({ taxRateBps: 0 });
    const visit = await seedPendingIncrease(schedulingRepo, state, 200, 230, false);
    // work_finished, not completed — the state Finalize & Send leaves a
    // still-pending-approval visit in (see finalize-and-send.ts).
    const current = state.serviceVisitsById.get(visit.id)!;
    state.serviceVisitsById.set(visit.id, { ...current, status: "work_finished", workFinishedAt: new Date() });

    const outcome = await confirmFinalTotalAndPay(schedulingRepo, bookingRepo, gateway, {
      serviceVisitId: visit.id,
      customerId: "customer-1",
      tipSelectionType: "percentage_20",
    });

    expect(outcome.outcome).toBe("ready");
    expect(state.serviceVisitsById.get(visit.id)?.status).toBe("completed");
    const pricing = await schedulingRepo.findServiceVisitPricingByVisitId(visit.id);
    expect(pricing?.priceStatus).toBe("confirmed");
    expect(pricing?.previouslyApprovedAmount).toBe(230);
    const payment = await schedulingRepo.findServiceVisitPaymentByVisitId(visit.id);
    expect(payment?.approvedAmount).toBe(230);
    expect(payment?.tipAmount).toBe(46); // 20% of 230
    expect(payment?.totalAmount).toBe(276); // 230 + 46, 0% tax
  });

  it("repeated confirmation on a work_finished visit cannot double-charge — the second call reuses the same PaymentIntent", async () => {
    const { repo: schedulingRepo, state } = createFakeSchedulingRepository();
    const { repo: bookingRepo } = createFakeBookingRepository({ customers: CUSTOMER_WITH_CARD });
    const { gateway, state: gatewayState } = createFakeVisitPaymentGateway({ taxRateBps: 0 });
    const visit = await seedPendingIncrease(schedulingRepo, state, 200, 230, false);
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

  it("translates a failure while finalizing the increase into a clear, actionable error instead of a raw exception", async () => {
    const { repo: schedulingRepo, state } = createFakeSchedulingRepository();
    const { repo: bookingRepo } = createFakeBookingRepository({ customers: CUSTOMER_WITH_CARD });
    const { gateway } = createFakeVisitPaymentGateway();
    const visit = await seedPendingIncrease(schedulingRepo, state, 200, 230, false);

    const originalConfirm = schedulingRepo.confirmServiceVisitPricing.bind(schedulingRepo);
    schedulingRepo.confirmServiceVisitPricing = async () => {
      throw new Error("service_visit_pricing pricing fields are immutable once the parent service_visit has completed");
    };

    await expect(
      confirmFinalTotalAndPay(schedulingRepo, bookingRepo, gateway, { serviceVisitId: visit.id, customerId: "customer-1" })
    ).rejects.toThrow(InvalidVisitStateError);

    schedulingRepo.confirmServiceVisitPricing = originalConfirm;
  });
});
