import { describe, expect, it } from "vitest";
import { planRecurringVisitDates } from "./plan-recurring-visit-dates";
import { replanRecurringVisit } from "./replan-recurring-visit";
import { scheduleRecurringVisitPlan } from "./schedule-recurring-visit-plan";
import { createFakeSchedulingRepository } from "./test-support/fake-scheduling-repository";
import { InvalidVisitStateError } from "./errors";

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
  return planRecurringVisitDates(repo, {
    recurringScheduleId: schedule.id,
    customerId: "customer-1",
    cadence: "weekly",
    firstDate: "2026-08-24",
    firstStartTime: "10:00",
  });
}

describe("replanRecurringVisit", () => {
  it("moves only the single targeted plan, leaving the others untouched", async () => {
    const { repo } = createFakeSchedulingRepository();
    const plans = await seedPlans(repo);

    await replanRecurringVisit(repo, { recurringVisitPlanId: plans[2].id, newPlannedDate: "2026-09-20", newPlannedStartTime: "13:00" });

    const updated = await repo.findRecurringVisitPlanById(plans[2].id);
    expect(updated?.plannedDate).toBe("2026-09-20");
    expect(updated?.plannedStartTime).toBe("13:00");

    const sibling = await repo.findRecurringVisitPlanById(plans[3].id);
    expect(sibling?.plannedDate).toBe("2026-09-14");
  });

  it("logs manual_single_move history", async () => {
    const { repo, state } = createFakeSchedulingRepository();
    const plans = await seedPlans(repo);
    await replanRecurringVisit(repo, { recurringVisitPlanId: plans[0].id, newPlannedDate: "2026-08-25", newPlannedStartTime: "11:00" });
    expect(state.recurringVisitPlanHistory.some((h) => h.changeReason === "manual_single_move")).toBe(true);
  });

  it("refuses to move an already-linked plan", async () => {
    const { repo } = createFakeSchedulingRepository();
    const plans = await seedPlans(repo);
    await scheduleRecurringVisitPlan(repo, {
      recurringVisitPlanId: plans[0].id,
      customerId: "customer-1",
      cleaningType: "standard",
      serviceAddressLine1: null,
      serviceAddressLine2: null,
      serviceCity: null,
      serviceState: null,
      serviceAddressIdentity: null,
    });

    await expect(
      replanRecurringVisit(repo, { recurringVisitPlanId: plans[0].id, newPlannedDate: "2026-09-01", newPlannedStartTime: "12:00" })
    ).rejects.toThrow(InvalidVisitStateError);
  });
});
