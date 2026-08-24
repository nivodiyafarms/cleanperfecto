import { describe, expect, it } from "vitest";
import { planRecurringVisitDates } from "./plan-recurring-visit-dates";
import { createFakeSchedulingRepository } from "./test-support/fake-scheduling-repository";

async function seedActiveSchedule(repo: ReturnType<typeof createFakeSchedulingRepository>["repo"]) {
  return repo.insertRecurringSchedule({
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
}

describe("planRecurringVisitDates", () => {
  it("creates exactly 6 planned records regardless of payment model", async () => {
    const { repo } = createFakeSchedulingRepository();
    const schedule = await seedActiveSchedule(repo);
    const plans = await planRecurringVisitDates(repo, {
      recurringScheduleId: schedule.id,
      customerId: "customer-1",
      cadence: "weekly",
      firstDate: "2026-08-24",
      firstStartTime: "10:00",
    });
    expect(plans.length).toBe(6);
    expect(plans.every((p) => p.status === "planned")).toBe(true);
  });

  it("creates no service_visits rows — plans are not fake operational visits", async () => {
    const { repo, state } = createFakeSchedulingRepository();
    const schedule = await seedActiveSchedule(repo);
    await planRecurringVisitDates(repo, {
      recurringScheduleId: schedule.id,
      customerId: "customer-1",
      cadence: "weekly",
      firstDate: "2026-08-24",
      firstStartTime: "10:00",
    });
    expect(state.serviceVisitsById.size).toBe(0);
  });

  it("preserves visit numbering 1..6 and correct cadence spacing", async () => {
    const { repo } = createFakeSchedulingRepository();
    const schedule = await seedActiveSchedule(repo);
    const plans = await planRecurringVisitDates(repo, {
      recurringScheduleId: schedule.id,
      customerId: "customer-1",
      cadence: "weekly",
      firstDate: "2026-08-24",
      firstStartTime: "10:00",
    });
    expect(plans.map((p) => p.visitNumber)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(plans.map((p) => p.plannedDate)).toEqual([
      "2026-08-24",
      "2026-08-31",
      "2026-09-07",
      "2026-09-14",
      "2026-09-21",
      "2026-09-28",
    ]);
  });

  it("logs initial_plan history for each plan", async () => {
    const { repo, state } = createFakeSchedulingRepository();
    const schedule = await seedActiveSchedule(repo);
    await planRecurringVisitDates(repo, {
      recurringScheduleId: schedule.id,
      customerId: "customer-1",
      cadence: "weekly",
      firstDate: "2026-08-24",
      firstStartTime: "10:00",
    });
    expect(state.recurringVisitPlanHistory.filter((h) => h.changeReason === "initial_plan").length).toBe(6);
  });

  it("is idempotent — calling twice does not create a second set of plans", async () => {
    const { repo, state } = createFakeSchedulingRepository();
    const schedule = await seedActiveSchedule(repo);
    const input = {
      recurringScheduleId: schedule.id,
      customerId: "customer-1",
      cadence: "weekly" as const,
      firstDate: "2026-08-24",
      firstStartTime: "10:00",
    };
    await planRecurringVisitDates(repo, input);
    await planRecurringVisitDates(repo, input);
    expect(state.recurringVisitPlansById.size).toBe(6);
  });

  it("works identically for a package-originated schedule (payment model agnostic)", async () => {
    const { repo } = createFakeSchedulingRepository();
    const schedule = await repo.insertRecurringSchedule({
      customerId: "customer-1",
      bookingOrderId: null,
      prepaidPackageId: "pkg-1",
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
    expect(plans.length).toBe(6);
  });

  it("creates zero service_visit_notifications rows — a still-'planned' slot with no real service_visit is never reminded", async () => {
    const { repo, state } = createFakeSchedulingRepository();
    const schedule = await seedActiveSchedule(repo);
    await planRecurringVisitDates(repo, {
      recurringScheduleId: schedule.id,
      customerId: "customer-1",
      cadence: "weekly",
      firstDate: "2026-08-24",
      firstStartTime: "10:00",
    });
    expect(state.notifications.size).toBe(0);
  });
});
