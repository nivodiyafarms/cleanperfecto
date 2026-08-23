import { describe, expect, it } from "vitest";
import type { CalculationInput } from "@/lib/pricing/types";
import { InvalidVisitStateError } from "./errors";
import { proposeRecurringScopeChange } from "./propose-recurring-scope-change";
import { requestVisitAddOns } from "./request-visit-add-ons";
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

async function seedPpcVisit(repo: ReturnType<typeof createFakeSchedulingRepository>["repo"]) {
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
  return repo.insertServiceVisit({
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
}

async function seedSecondPpcVisit(repo: ReturnType<typeof createFakeSchedulingRepository>["repo"], recurringScheduleId: string) {
  return repo.insertServiceVisit({
    customerId: "customer-1",
    quoteRequestId: null,
    bookingOrderId: null,
    prepaidPackageId: null,
    recurringScheduleId,
    visitNumber: 3,
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
}

describe("requestVisitAddOns", () => {
  it("never propagates one visit's extras to a different visit under the same recurring schedule", async () => {
    const { repo } = createFakeSchedulingRepository();
    const visitA = await seedPpcVisit(repo);
    const visitB = await seedSecondPpcVisit(repo, visitA.recurringScheduleId as string);

    await requestVisitAddOns(repo, { serviceVisitId: visitA.id, addOnIds: ["inside_oven", "inside_refrigerator"] });

    const pricingB = await repo.findServiceVisitPricingByVisitId(visitB.id);
    expect(pricingB).toBeNull();
  });


  it("splits priced add-ons from manual-quote ones, pricing only the former", async () => {
    const { repo } = createFakeSchedulingRepository();
    const visit = await seedPpcVisit(repo);

    const result = await requestVisitAddOns(repo, {
      serviceVisitId: visit.id,
      addOnIds: ["inside_oven", "boxing_packing"],
    });

    expect(result.pricing.addOnIds).toEqual(["inside_oven"]);
    expect(result.pricing.addOnAmount).toBe(35);
    expect(result.manualQuoteAddOnIds).toEqual(["boxing_packing"]);
  });

  it("does not price a purely manual-quote selection at all", async () => {
    const { repo } = createFakeSchedulingRepository();
    const visit = await seedPpcVisit(repo);

    const result = await requestVisitAddOns(repo, { serviceVisitId: visit.id, addOnIds: ["boxing_packing"] });

    expect(result.pricing.addOnAmount).toBe(0);
    expect(result.manualQuoteAddOnIds).toEqual(["boxing_packing"]);
  });

  it("refuses to add extras to a completed visit", async () => {
    const { repo } = createFakeSchedulingRepository();
    const visit = await seedPpcVisit(repo);
    await repo.setServiceVisitSchedule({
      serviceVisitId: visit.id,
      confirmedStartAt: new Date("2026-08-31T15:00:00Z"),
      confirmedEndAt: new Date("2026-08-31T17:00:00Z"),
      estimatedLaborMinutes: 120,
      estimatedServiceMinutes: 120,
      recommendedCleanerCount: 1,
      turnaroundBufferMinutes: 60,
      cleanerIds: ["cleaner-1"],
    });
    await repo.completeServiceVisitRpc(visit.id);

    await expect(requestVisitAddOns(repo, { serviceVisitId: visit.id, addOnIds: ["inside_oven"] })).rejects.toThrow(
      InvalidVisitStateError
    );
  });

  it("refuses to add extras to a cancelled visit", async () => {
    const { repo } = createFakeSchedulingRepository();
    const visit = await seedPpcVisit(repo);
    await repo.cancelServiceVisit(visit.id);

    await expect(requestVisitAddOns(repo, { serviceVisitId: visit.id, addOnIds: ["inside_oven"] })).rejects.toThrow(
      InvalidVisitStateError
    );
  });
});
