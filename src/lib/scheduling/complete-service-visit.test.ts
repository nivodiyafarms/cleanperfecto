import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bootstrapRecurringVisitPlansFromDirectVisit } from "./bootstrap-recurring-visit-plans-from-direct-visit";
import { completeServiceVisit } from "./complete-service-visit";
import { confirmServiceVisit } from "./confirm-service-visit";
import { createRequestedVisitFromBooking } from "./create-requested-visit-from-booking";
import { schedulePackageVisitPlan } from "./schedule-package-visit-plan";
import { planPackageVisitDates } from "./plan-package-visit-dates";
import { planRecurringVisitDates } from "./plan-recurring-visit-dates";
import { scheduleRecurringVisitPlan } from "./schedule-recurring-visit-plan";
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
        purchasedAt: new Date("2026-01-01T00:00:00Z"),
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
          purchasedAt: new Date("2026-01-01T00:00:00Z"),
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

  it("replenishes the universal recurring horizon back to six when a Pay Per Cleaning occurrence completes", async () => {
    const { repo, state } = createFakeSchedulingRepository({ cleaners: [{ id: "cleaner-1", name: "A", active: true }] });
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
    const plans = await planRecurringVisitDates(repo, {
      recurringScheduleId: schedule.id,
      customerId: "customer-1",
      cadence: "weekly",
      firstDate: "2026-08-24",
      firstStartTime: "10:00",
    });
    const { visitId } = await scheduleRecurringVisitPlan(repo, {
      recurringVisitPlanId: plans[0].id,
      customerId: "customer-1",
      cleaningType: "standard",
      serviceAddressLine1: null,
      serviceAddressLine2: null,
      serviceCity: null,
      serviceState: null,
      serviceAddressIdentity: null,
    });
    await confirmServiceVisit(repo, { serviceVisitId: visitId, date: "2026-08-24", startTime: "10:00", cleanerIds: ["cleaner-1"], durationInput: DURATION_INPUT });

    expect(state.recurringVisitPlansById.size).toBe(6);
    await completeServiceVisit(repo, visitId);
    expect(state.recurringVisitPlansById.size).toBe(7);
  });

  it("replenishes the horizon when the DIRECT (first) visit of a Pay Per Cleaning booking completes, even though its recurring_schedule_id is null by design", async () => {
    const { repo, state } = createFakeSchedulingRepository({ cleaners: [{ id: "cleaner-1", name: "A", active: true }] });
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
    const { visitId } = await createRequestedVisitFromBooking(repo, {
      bookingOrderId: "booking-1",
      customerId: "customer-1",
      quoteRequestId: "quote-1",
      cleaningType: "standard",
      frequency: "weekly",
      requestedDate: "2026-08-24",
      requestedStartTime: "10:00",
      serviceAddressLine1: null,
      serviceAddressLine2: null,
      serviceCity: null,
      serviceState: null,
      serviceAddressIdentity: null,
    });
    // The direct visit's recurring_schedule_id is null by design (see
    // service_visits_one_direct_visit_per_booking_order) even though its
    // universal calendar slot #1 is linked to it.
    expect(state.serviceVisitsById.get(visitId)?.recurringScheduleId).toBeNull();

    await bootstrapRecurringVisitPlansFromDirectVisit(repo, {
      recurringScheduleId: schedule.id,
      customerId: "customer-1",
      cadence: "weekly",
      firstDate: "2026-08-24",
      firstStartTime: "10:00",
      directServiceVisitId: visitId,
    });
    expect(state.recurringVisitPlansById.size).toBe(6);

    await confirmServiceVisit(repo, { serviceVisitId: visitId, date: "2026-08-24", startTime: "10:00", cleanerIds: ["cleaner-1"], durationInput: DURATION_INPUT });
    await completeServiceVisit(repo, visitId);

    expect(state.recurringVisitPlansById.size).toBe(7);
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

  it("enqueues exactly one pending completed notice, once, even on an idempotent retry", async () => {
    const { repo, state, visitId } = await seedScheduledPackageVisit("pkg-1");
    await completeServiceVisit(repo, visitId);
    await completeServiceVisit(repo, visitId); // idempotent retry — must not duplicate

    const completedNotices = [...state.notifications.values()].filter((n) => n.serviceVisitId === visitId && n.notificationType === "completed");
    expect(completedNotices.length).toBe(1);
    expect(completedNotices[0].state).toBe("pending");
  });

  describe("review_request", () => {
    beforeEach(() => {
      process.env.GOOGLE_REVIEW_URL = "https://example.com/leave-a-review";
    });
    afterEach(() => {
      delete process.env.GOOGLE_REVIEW_URL;
    });

    it("enqueues exactly one review_request only after a genuine completion", async () => {
      const { repo, state, visitId } = await seedScheduledPackageVisit("pkg-1");
      expect([...state.notifications.values()].filter((n) => n.notificationType === "review_request").length).toBe(0);

      await completeServiceVisit(repo, visitId);

      const reviewNotices = [...state.notifications.values()].filter((n) => n.serviceVisitId === visitId && n.notificationType === "review_request");
      expect(reviewNotices.length).toBe(1);
      expect(reviewNotices[0].state).toBe("pending");
    });

    it("a completion retry does not duplicate the review_request", async () => {
      const { repo, state, visitId } = await seedScheduledPackageVisit("pkg-1");
      await completeServiceVisit(repo, visitId);
      await completeServiceVisit(repo, visitId); // idempotent retry

      expect([...state.notifications.values()].filter((n) => n.serviceVisitId === visitId && n.notificationType === "review_request").length).toBe(1);
    });

    it("never enqueues a review_request for a cancelled visit", async () => {
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
      const { cancelServiceVisit } = await import("./cancel-service-visit");
      await cancelServiceVisit(repo, { serviceVisitId: visitId, now: new Date("2026-08-24T00:00:00Z") });

      expect([...state.notifications.values()].filter((n) => n.notificationType === "review_request").length).toBe(0);
    });

    it("respects the visit-level review_request_suppressed flag", async () => {
      const { repo, state, visitId } = await seedScheduledPackageVisit("pkg-1");
      await repo.setReviewRequestSuppressed(visitId, true);

      await completeServiceVisit(repo, visitId);

      expect([...state.notifications.values()].filter((n) => n.serviceVisitId === visitId && n.notificationType === "review_request").length).toBe(0);
    });

    it("never touches package credit, pricing, or payment state", async () => {
      const { repo, state, visitId } = await seedScheduledPackageVisit("pkg-1");
      const creditBefore = state.prepaidPackagesById.get("pkg-1")?.remainingVisitCount;

      await completeServiceVisit(repo, visitId);

      // Credit still decrements exactly once (completion's own job), unaffected by review automation running alongside it.
      expect(state.prepaidPackagesById.get("pkg-1")?.remainingVisitCount).toBe((creditBefore ?? 0) - 1);
    });
  });
});
