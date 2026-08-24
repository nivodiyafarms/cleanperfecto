import { describe, expect, it } from "vitest";
import { bootstrapRecurringVisitPlansFromDirectVisit } from "./bootstrap-recurring-visit-plans-from-direct-visit";
import { cancelServiceVisit } from "./cancel-service-visit";
import { confirmServiceVisit } from "./confirm-service-visit";
import { createRequestedVisitFromBooking } from "./create-requested-visit-from-booking";
import { planRecurringVisitDates } from "./plan-recurring-visit-dates";
import { scheduleRecurringVisitPlan } from "./schedule-recurring-visit-plan";
import { createFakeSchedulingRepository } from "./test-support/fake-scheduling-repository";

const DURATION_INPUT = { cleaningType: "standard" as const, sizeTier: "2br_2ba" as const, condition: "light" as const };

async function seedScheduledVisit(repo: ReturnType<typeof createFakeSchedulingRepository>["repo"]) {
  const { visitId } = await createRequestedVisitFromBooking(repo, {
    bookingOrderId: "booking-1",
    customerId: "customer-1",
    quoteRequestId: "quote-1",
    cleaningType: "standard",
    frequency: "one_time",
    requestedDate: "2026-08-30",
    requestedStartTime: "10:00",
    serviceAddressLine1: null,
    serviceAddressLine2: null,
    serviceCity: null,
    serviceState: null,
    serviceAddressIdentity: null,
  });
  await confirmServiceVisit(repo, { serviceVisitId: visitId, date: "2026-08-30", startTime: "10:00", cleanerIds: ["cleaner-1"], durationInput: DURATION_INPUT });
  return visitId;
}

describe("cancelServiceVisit", () => {
  it("cancels a merely-requested visit for free (no confirmed time to assess notice against)", async () => {
    const { repo, state } = createFakeSchedulingRepository();
    const { visitId } = await createRequestedVisitFromBooking(repo, {
      bookingOrderId: "booking-1",
      customerId: "customer-1",
      quoteRequestId: "quote-1",
      cleaningType: "standard",
      frequency: "one_time",
      requestedDate: "2026-08-30",
      requestedStartTime: "10:00",
      serviceAddressLine1: null,
      serviceAddressLine2: null,
      serviceCity: null,
      serviceState: null,
      serviceAddressIdentity: null,
    });
    const result = await cancelServiceVisit(repo, { serviceVisitId: visitId, now: new Date() });
    expect(result.changed).toBe(true);
    expect(result.fee).toBeNull();
    expect(state.serviceVisitsById.get(visitId)?.status).toBe("cancelled");
  });

  it("assesses the 48+ hour free tier for a scheduled visit cancelled well in advance", async () => {
    const { repo, state } = createFakeSchedulingRepository({ cleaners: [{ id: "cleaner-1", name: "A", active: true }] });
    const visitId = await seedScheduledVisit(repo);
    const result = await cancelServiceVisit(repo, { serviceVisitId: visitId, now: new Date("2026-08-25T00:00:00Z") });
    expect(result.fee).toBeNull();
    expect(state.serviceVisitsById.get(visitId)?.status).toBe("cancelled");
  });

  it("assesses the $75 dispatched/no-access fee regardless of notice", async () => {
    const { repo, state } = createFakeSchedulingRepository({ cleaners: [{ id: "cleaner-1", name: "A", active: true }] });
    const visitId = await seedScheduledVisit(repo);
    const result = await cancelServiceVisit(repo, { serviceVisitId: visitId, now: new Date("2026-08-25T00:00:00Z"), noAccess: true });
    expect(result.fee?.amount).toBe(75);
    expect(state.feeAssessments.some((f) => f.feeType === "no_access")).toBe(true);
  });

  it("releases cleaner assignments on cancellation", async () => {
    const { repo, state } = createFakeSchedulingRepository({ cleaners: [{ id: "cleaner-1", name: "A", active: true }] });
    const visitId = await seedScheduledVisit(repo);
    await cancelServiceVisit(repo, { serviceVisitId: visitId, now: new Date("2026-08-25T00:00:00Z") });
    expect(state.assignments.filter((a) => a.serviceVisitId === visitId && a.unassignedAt === null).length).toBe(0);
  });

  it("replenishes the universal recurring horizon back to six when an occurrence is cancelled, without consuming a package credit", async () => {
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

    await cancelServiceVisit(repo, { serviceVisitId: visitId, now: new Date("2026-08-01T00:00:00Z") });

    expect(state.recurringVisitPlansById.size).toBe(7);
    expect(state.packageVisitUsages.size).toBe(0);
  });

  it("replenishes the horizon when the DIRECT (first) visit of a Pay Per Cleaning booking is cancelled, even though its recurring_schedule_id is null by design", async () => {
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
    await cancelServiceVisit(repo, { serviceVisitId: visitId, now: new Date("2026-08-01T00:00:00Z") });

    expect(state.recurringVisitPlansById.size).toBe(7);
    expect(state.packageVisitUsages.size).toBe(0);
  });

  it("is a safe no-op when the visit is already cancelled", async () => {
    const { repo } = createFakeSchedulingRepository();
    const { visitId } = await createRequestedVisitFromBooking(repo, {
      bookingOrderId: "booking-1",
      customerId: "customer-1",
      quoteRequestId: "quote-1",
      cleaningType: "standard",
      frequency: "one_time",
      requestedDate: "2026-08-30",
      requestedStartTime: "10:00",
      serviceAddressLine1: null,
      serviceAddressLine2: null,
      serviceCity: null,
      serviceState: null,
      serviceAddressIdentity: null,
    });
    await cancelServiceVisit(repo, { serviceVisitId: visitId, now: new Date() });
    const second = await cancelServiceVisit(repo, { serviceVisitId: visitId, now: new Date() });
    expect(second.changed).toBe(false);
  });
});
