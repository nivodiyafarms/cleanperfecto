import { describe, expect, it } from "vitest";
import type { CalculationInput } from "@/lib/pricing/types";
import { approveVisitPricingIncrease, confirmVisitPricing } from "./confirm-visit-pricing";
import { InvalidVisitStateError } from "./errors";
import { estimateVisitPricing } from "./estimate-visit-pricing";
import { proposeRecurringScopeChange } from "./propose-recurring-scope-change";
import { createFakeSchedulingRepository } from "./test-support/fake-scheduling-repository";

const BASE_INPUT: CalculationInput = {
  propertyKind: "home",
  cleaningType: "standard",
  condition: "light",
  sizeTier: "2br_2ba",
  zip: "75056",
  frequency: "weekly",
  isPrepaidPackage: false,
  visitCount: 1,
  addOnIds: [],
  firstCleaningEligible: false,
  asOf: new Date("2026-08-24T00:00:00Z"),
};

async function seedEstimatedVisit(repo: ReturnType<typeof createFakeSchedulingRepository>["repo"]) {
  const schedule = await repo.insertRecurringSchedule({
    customerId: "customer-1",
    bookingOrderId: "booking-1",
    prepaidPackageId: null,
    cadence: "weekly",
    preferredDayOfWeek: 1,
    preferredStartTime: "10:00",
    timezone: "America/Chicago",
    effectiveFrom: "2026-08-24",
    supersedesId: null,
  });
  await proposeRecurringScopeChange(repo, {
    recurringScheduleId: schedule.id,
    customerId: "customer-1",
    newBaseInput: BASE_INPUT,
    effectiveFromVisitNumber: 1,
  });
  const visit = await repo.insertServiceVisit({
    customerId: "customer-1",
    quoteRequestId: null,
    bookingOrderId: null,
    prepaidPackageId: null,
    recurringScheduleId: schedule.id,
    visitNumber: 2,
    cleaningType: "standard",
    frequency: null,
    requestedStartAt: null,
    timezone: "America/Chicago",
    serviceAddressLine1: null,
    serviceAddressLine2: null,
    serviceCity: null,
    serviceState: null,
    serviceAddressIdentity: null,
  });
  await estimateVisitPricing(repo, { serviceVisitId: visit.id, addOnIds: [] });
  return visit;
}

describe("confirmVisitPricing", () => {
  it("confirms an estimate that doesn't require approval", async () => {
    const { repo } = createFakeSchedulingRepository();
    const visit = await seedEstimatedVisit(repo);
    const confirmed = await confirmVisitPricing(repo, { serviceVisitId: visit.id, confirmedBy: "admin:1" });
    expect(confirmed.priceStatus).toBe("confirmed");
    expect(confirmed.confirmedBy).toBe("admin:1");
  });

  it("sets payment_status to awaiting_completion once confirmed with a nonzero amount due", async () => {
    const { repo } = createFakeSchedulingRepository();
    const visit = await seedEstimatedVisit(repo);
    const confirmed = await confirmVisitPricing(repo, { serviceVisitId: visit.id, confirmedBy: "admin:1" });
    expect(confirmed.paymentStatus).toBe("awaiting_completion");
  });

  it("refuses to confirm pricing that still requires customer approval", async () => {
    const { repo } = createFakeSchedulingRepository();
    const visit = await seedEstimatedVisit(repo);
    await confirmVisitPricing(repo, { serviceVisitId: visit.id, confirmedBy: "admin:1" });
    await estimateVisitPricing(repo, { serviceVisitId: visit.id, addOnIds: ["inside_oven"] });

    await expect(confirmVisitPricing(repo, { serviceVisitId: visit.id, confirmedBy: "admin:1" })).rejects.toThrow(
      InvalidVisitStateError
    );
  });

  it("approveVisitPricingIncrease clears the gate so admin can then confirm", async () => {
    const { repo } = createFakeSchedulingRepository();
    const visit = await seedEstimatedVisit(repo);
    await confirmVisitPricing(repo, { serviceVisitId: visit.id, confirmedBy: "admin:1" });
    await estimateVisitPricing(repo, { serviceVisitId: visit.id, addOnIds: ["inside_oven"] });

    const approved = await approveVisitPricingIncrease(repo, visit.id);
    expect(approved.requiresCustomerApproval).toBe(false);

    const confirmed = await confirmVisitPricing(repo, { serviceVisitId: visit.id, confirmedBy: "admin:1" });
    expect(confirmed.priceStatus).toBe("confirmed");
  });

  it("price_status and payment_status are independent — updating one never changes the other", async () => {
    const { repo } = createFakeSchedulingRepository();
    const visit = await seedEstimatedVisit(repo);
    const confirmed = await confirmVisitPricing(repo, { serviceVisitId: visit.id, confirmedBy: "admin:1" });
    expect(confirmed.priceStatus).toBe("confirmed");
    expect(confirmed.paymentStatus).toBe("awaiting_completion");

    const paid = await repo.updateServiceVisitPricingPaymentStatus(visit.id, "paid");
    expect(paid?.paymentStatus).toBe("paid");
    // price_status/total/base/add-ons are untouched by a payment_status change.
    expect(paid?.priceStatus).toBe("confirmed");
    expect(paid?.totalAmount).toBe(confirmed.totalAmount);
  });
});
