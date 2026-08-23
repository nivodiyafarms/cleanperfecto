import { describe, expect, it } from "vitest";
import { completeServiceVisit } from "./complete-service-visit";
import { confirmServiceVisit } from "./confirm-service-visit";
import { createRequestedVisitFromBooking } from "./create-requested-visit-from-booking";
import { schedulePackageVisitPlan } from "./schedule-package-visit-plan";
import { planPackageVisitDates } from "./plan-package-visit-dates";
import { createFakeSchedulingRepository } from "./test-support/fake-scheduling-repository";

const DURATION_INPUT = { cleaningType: "standard" as const, sizeTier: "2br_2ba" as const, condition: "light" as const };

async function seedScheduledPackageVisit(prepaidPackageId: string) {
  const { repo, state } = createFakeSchedulingRepository({
    cleaners: [{ id: "cleaner-1", name: "A", active: true }],
    prepaidPackages: [
      {
        id: prepaidPackageId,
        customerId: "customer-1",
        bookingOrderId: "booking-1",
        frequency: "weekly",
        purchasedVisitCount: 6,
        remainingVisitCount: 6,
        effectivePricePerVisit: 130,
        status: "active",
      },
    ],
  });

  const plans = await planPackageVisitDates(repo, {
    prepaidPackageId,
    customerId: "customer-1",
    cadence: "weekly",
    firstDate: "2026-08-24",
    firstStartTime: "10:00",
  });

  const { visitId } = await schedulePackageVisitPlan(repo, {
    packageVisitPlanId: plans[0].id,
    customerId: "customer-1",
    cleaningType: "standard",
    serviceAddressLine1: null,
    serviceAddressLine2: null,
    serviceCity: null,
    serviceState: null,
    serviceAddressIdentity: null,
  });

  await confirmServiceVisit(repo, { serviceVisitId: visitId, date: "2026-08-24", startTime: "10:00", cleanerIds: ["cleaner-1"], durationInput: DURATION_INPUT });

  return { repo, state, visitId };
}

describe("completeServiceVisit", () => {
  it("transitions a scheduled visit to completed", async () => {
    const { repo, state, visitId } = await seedScheduledPackageVisit("pkg-1");
    await completeServiceVisit(repo, visitId);
    expect(state.serviceVisitsById.get(visitId)?.status).toBe("completed");
  });

  it("decrements remaining_visit_count exactly once for a package visit's completion", async () => {
    const { repo, state, visitId } = await seedScheduledPackageVisit("pkg-1");
    await completeServiceVisit(repo, visitId);
    expect(state.prepaidPackagesById.get("pkg-1")?.remainingVisitCount).toBe(5);
  });

  it("does not decrement remaining_visit_count on scheduling, rescheduling, or cancellation — only on completion", async () => {
    const { repo, state, visitId } = await seedScheduledPackageVisit("pkg-1");
    // Visit was already scheduled (confirmed) in the seed helper above —
    // remaining_visit_count must still read the full purchased amount.
    expect(state.prepaidPackagesById.get("pkg-1")?.remainingVisitCount).toBe(6);
    await completeServiceVisit(repo, visitId);
    expect(state.prepaidPackagesById.get("pkg-1")?.remainingVisitCount).toBe(5);
  });

  it("is idempotent — completing an already-completed visit does not decrement a second time", async () => {
    const { repo, state, visitId } = await seedScheduledPackageVisit("pkg-1");
    await completeServiceVisit(repo, visitId);
    const changedAgain = await completeServiceVisit(repo, visitId);
    expect(changedAgain).toBe(false);
    expect(state.prepaidPackagesById.get("pkg-1")?.remainingVisitCount).toBe(5);
  });

  it("never lets remaining_visit_count go negative", async () => {
    const { repo, state } = createFakeSchedulingRepository({
      cleaners: [{ id: "cleaner-1", name: "A", active: true }],
      prepaidPackages: [
        {
          id: "pkg-zero",
          customerId: "customer-1",
          bookingOrderId: "booking-1",
          frequency: "weekly",
          purchasedVisitCount: 6,
          remainingVisitCount: 0,
          effectivePricePerVisit: 130,
          status: "active",
        },
      ],
    });
    const plans = await planPackageVisitDates(repo, {
      prepaidPackageId: "pkg-zero",
      customerId: "customer-1",
      cadence: "weekly",
      firstDate: "2026-08-24",
      firstStartTime: "10:00",
    });
    const { visitId } = await schedulePackageVisitPlan(repo, {
      packageVisitPlanId: plans[0].id,
      customerId: "customer-1",
      cleaningType: "standard",
      serviceAddressLine1: null,
      serviceAddressLine2: null,
      serviceCity: null,
      serviceState: null,
      serviceAddressIdentity: null,
    });
    await confirmServiceVisit(repo, { serviceVisitId: visitId, date: "2026-08-24", startTime: "10:00", cleanerIds: ["cleaner-1"], durationInput: DURATION_INPUT });
    await completeServiceVisit(repo, visitId);
    expect(state.prepaidPackagesById.get("pkg-zero")?.remainingVisitCount).toBe(0);
  });

  it("does not decrement any package for a non-package (normal booking) visit", async () => {
    const { repo, state } = createFakeSchedulingRepository({ cleaners: [{ id: "cleaner-1", name: "A", active: true }] });
    const { visitId } = await createRequestedVisitFromBooking(repo, {
      bookingOrderId: "booking-1",
      customerId: "customer-1",
      quoteRequestId: "quote-1",
      cleaningType: "standard",
      frequency: "one_time",
      requestedDate: "2026-08-24",
      requestedStartTime: "10:00",
      serviceAddressLine1: null,
      serviceAddressLine2: null,
      serviceCity: null,
      serviceState: null,
      serviceAddressIdentity: null,
    });
    await confirmServiceVisit(repo, { serviceVisitId: visitId, date: "2026-08-24", startTime: "10:00", cleanerIds: ["cleaner-1"], durationInput: DURATION_INPUT });
    await completeServiceVisit(repo, visitId);
    expect(state.serviceVisitsById.get(visitId)?.status).toBe("completed");
    expect(state.packageVisitUsages.size).toBe(0);
  });
});
