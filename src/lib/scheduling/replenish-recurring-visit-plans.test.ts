import { describe, expect, it } from "vitest";
import { completeServiceVisit } from "./complete-service-visit";
import { confirmServiceVisit } from "./confirm-service-visit";
import { planRecurringVisitDates } from "./plan-recurring-visit-dates";
import { replenishRecurringVisitPlans } from "./replenish-recurring-visit-plans";
import { scheduleRecurringVisitPlan } from "./schedule-recurring-visit-plan";
import { createFakeSchedulingRepository } from "./test-support/fake-scheduling-repository";

const DURATION_INPUT = { cleaningType: "standard" as const, sizeTier: "2br_2ba" as const, condition: "light" as const };

async function seedActivePpcSchedule(repo: ReturnType<typeof createFakeSchedulingRepository>["repo"]) {
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
  return { schedule, plans };
}

describe("replenishRecurringVisitPlans", () => {
  it("does nothing when the horizon is already full (6 outstanding)", async () => {
    const { repo, state } = createFakeSchedulingRepository();
    const { schedule } = await seedActivePpcSchedule(repo);
    const created = await replenishRecurringVisitPlans(repo, schedule.id);
    expect(created.length).toBe(0);
    expect(state.recurringVisitPlansById.size).toBe(6);
  });

  it("tops the horizon back up to 6 after a completed occurrence (called directly, in isolation)", async () => {
    const { repo, state } = createFakeSchedulingRepository({ cleaners: [{ id: "cleaner-1", name: "A", active: true }] });
    const { schedule, plans } = await seedActivePpcSchedule(repo);

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
    // Complete via the raw repo RPC (bypassing completeServiceVisit's own
    // automatic replenishment call) so this test isolates
    // replenishRecurringVisitPlans' own logic — the "completion
    // automatically replenishes" behavior itself is covered by
    // complete-service-visit.test.ts.
    await repo.completeServiceVisitRpc(visitId);

    const created = await replenishRecurringVisitPlans(repo, schedule.id);
    expect(created.length).toBe(1);
    expect(created[0].visitNumber).toBe(7);
    expect(created[0].plannedDate).toBe("2026-10-05"); // one cadence interval after visit #6's 2026-09-28

    expect(state.recurringVisitPlansById.size).toBe(7);
  });

  it("is a no-op when completeServiceVisit already replenished the horizon", async () => {
    const { repo, state } = createFakeSchedulingRepository({ cleaners: [{ id: "cleaner-1", name: "A", active: true }] });
    const { schedule, plans } = await seedActivePpcSchedule(repo);

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
    await completeServiceVisit(repo, visitId);
    expect(state.recurringVisitPlansById.size).toBe(7);

    const created = await replenishRecurringVisitPlans(repo, schedule.id);
    expect(created.length).toBe(0);
    expect(state.recurringVisitPlansById.size).toBe(7);
  });

  it("tops the horizon back up after a cancelled occurrence too", async () => {
    const { repo } = createFakeSchedulingRepository({ cleaners: [{ id: "cleaner-1", name: "A", active: true }] });
    const { schedule, plans } = await seedActivePpcSchedule(repo);

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
    await repo.cancelServiceVisit(visitId);

    const created = await replenishRecurringVisitPlans(repo, schedule.id);
    expect(created.length).toBe(1);
  });

  it("logs replenishment history for each newly generated plan", async () => {
    const { repo, state } = createFakeSchedulingRepository({ cleaners: [{ id: "cleaner-1", name: "A", active: true }] });
    const { schedule, plans } = await seedActivePpcSchedule(repo);
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
    await repo.cancelServiceVisit(visitId);
    await replenishRecurringVisitPlans(repo, schedule.id);
    expect(state.recurringVisitPlanHistory.filter((h) => h.changeReason === "replenishment").length).toBe(1);
  });

  it("never creates fake service_visits rows while replenishing", async () => {
    const { repo, state } = createFakeSchedulingRepository({ cleaners: [{ id: "cleaner-1", name: "A", active: true }] });
    const { schedule, plans } = await seedActivePpcSchedule(repo);
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
    await repo.cancelServiceVisit(visitId);
    await replenishRecurringVisitPlans(repo, schedule.id);
    // Only the one linked (now-cancelled) visit exists — replenishment itself creates zero new service_visits.
    expect(state.serviceVisitsById.size).toBe(1);
  });

  it("does not replenish a non-active (e.g. superseded) schedule", async () => {
    const { repo } = createFakeSchedulingRepository();
    const { schedule } = await seedActivePpcSchedule(repo);
    await repo.supersedeRecurringSchedule(schedule.id, "2026-08-25");
    const created = await replenishRecurringVisitPlans(repo, schedule.id);
    expect(created.length).toBe(0);
  });
});
