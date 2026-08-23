import { describe, expect, it } from "vitest";
import { completeServiceVisit } from "./complete-service-visit";
import { confirmServiceVisit } from "./confirm-service-visit";
import { planRecurringVisitDates } from "./plan-recurring-visit-dates";
import { replanRecurringCadence } from "./replan-recurring-cadence";
import { scheduleRecurringVisitPlan } from "./schedule-recurring-visit-plan";
import { createFakeSchedulingRepository } from "./test-support/fake-scheduling-repository";

const DURATION_INPUT = { cleaningType: "standard" as const, sizeTier: "2br_2ba" as const, condition: "light" as const };

async function seedPlans(repo: ReturnType<typeof createFakeSchedulingRepository>["repo"]) {
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

describe("replanRecurringCadence", () => {
  it("regenerates remaining still-planned visits starting at the effective visit number, using the new cadence", async () => {
    const { repo } = createFakeSchedulingRepository();
    const { schedule } = await seedPlans(repo);

    const updated = await replanRecurringCadence(repo, {
      recurringScheduleId: schedule.id,
      effectiveFromVisitNumber: 3,
      newCadence: "biweekly",
      newFirstDate: "2026-09-20",
      newFirstStartTime: "13:00",
    });

    expect(updated.map((p) => p.visitNumber)).toEqual([3, 4, 5, 6]);
    expect(updated.map((p) => p.plannedDate)).toEqual(["2026-09-20", "2026-10-04", "2026-10-18", "2026-11-01"]);

    // Visits 1-2 are untouched, still under the ORIGINAL schedule id — only
    // visitNumber >= effectiveFromVisitNumber (3) were re-parented onto the
    // new schedule version.
    const stillUnderOldSchedule = await repo.listRecurringVisitPlans(schedule.id);
    expect(stillUnderOldSchedule.map((p) => p.visitNumber)).toEqual([1, 2]);
    expect(stillUnderOldSchedule.find((p) => p.visitNumber === 1)?.plannedDate).toBe("2026-08-24");
  });

  it("preserves visit_number identity while re-parenting still-planned rows onto the new schedule version", async () => {
    const { repo } = createFakeSchedulingRepository();
    const { schedule } = await seedPlans(repo);
    const updated = await replanRecurringCadence(repo, {
      recurringScheduleId: schedule.id,
      effectiveFromVisitNumber: 1,
      newCadence: "biweekly",
      newFirstDate: "2026-09-20",
      newFirstStartTime: "13:00",
    });
    expect(updated.map((p) => p.visitNumber)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("versions recurring_schedules (supersedes the old one) rather than mutating it in place", async () => {
    const { repo } = createFakeSchedulingRepository();
    const { schedule } = await seedPlans(repo);
    await replanRecurringCadence(repo, {
      recurringScheduleId: schedule.id,
      effectiveFromVisitNumber: 1,
      newCadence: "biweekly",
      newFirstDate: "2026-09-20",
      newFirstStartTime: "13:00",
    });
    const old = await repo.findRecurringScheduleById(schedule.id);
    expect(old?.status).toBe("superseded");
    expect(old?.cadence).toBe("weekly");
  });

  it("never regenerates an already-linked (real) visit — that visit's own reschedule path applies instead", async () => {
    const { repo, state } = createFakeSchedulingRepository({ cleaners: [{ id: "cleaner-1", name: "A", active: true }] });
    const { schedule, plans } = await seedPlans(repo);

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

    await replanRecurringCadence(repo, {
      recurringScheduleId: schedule.id,
      effectiveFromVisitNumber: 1,
      newCadence: "biweekly",
      newFirstDate: "2026-09-20",
      newFirstStartTime: "13:00",
    });

    expect(state.serviceVisitsById.get(visitId)?.confirmedStartAt?.toISOString().slice(0, 10)).toBe("2026-08-24");
    expect(state.recurringVisitPlansById.get(plans[0].id)?.plannedDate).toBe("2026-08-24");
    expect(state.recurringVisitPlansById.get(plans[0].id)?.recurringScheduleId).toBe(schedule.id);
  });

  it("logs cadence_regeneration history for each regenerated plan", async () => {
    const { repo, state } = createFakeSchedulingRepository();
    const { schedule } = await seedPlans(repo);
    await replanRecurringCadence(repo, {
      recurringScheduleId: schedule.id,
      effectiveFromVisitNumber: 1,
      newCadence: "biweekly",
      newFirstDate: "2026-09-20",
      newFirstStartTime: "13:00",
    });
    expect(state.recurringVisitPlanHistory.filter((h) => h.changeReason === "cadence_regeneration").length).toBe(6);
  });
});
