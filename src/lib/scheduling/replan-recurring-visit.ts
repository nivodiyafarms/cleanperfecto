import { InvalidVisitStateError } from "./errors";
import type { SchedulingRepository } from "./repository";
import { syncPackagePlanFromRecurringPlan } from "./sync-linked-recurring-package-plan";
import type { CalendarDate, TimeOfDay } from "./types";

export interface ReplanRecurringVisitInput {
  recurringVisitPlanId: string;
  newPlannedDate: CalendarDate;
  newPlannedStartTime: TimeOfDay;
}

/**
 * "Change only this one planned cleaning" — universal equivalent of
 * replan-package-visit.ts (Pay Per Cleaning and prepaid-package customers
 * alike). Moves a single, not-yet-linked recurring_visit_plans row; every
 * other plan under the same schedule is untouched. Once a plan is 'linked'
 * to a real service_visit, its date lives on that visit instead — an
 * already-confirmed visit is changed via request-visit-reschedule.ts
 * (customer request, pending admin confirmation), never here.
 */
export async function replanRecurringVisit(repo: SchedulingRepository, input: ReplanRecurringVisitInput): Promise<void> {
  const plan = await repo.findRecurringVisitPlanById(input.recurringVisitPlanId);
  if (!plan) {
    throw new InvalidVisitStateError(`recurring_visit_plan ${input.recurringVisitPlanId} not found`);
  }
  if (plan.status !== "planned") {
    throw new InvalidVisitStateError(
      `recurring_visit_plan ${input.recurringVisitPlanId} is already linked to a real visit — use request-visit-reschedule.ts instead`
    );
  }

  await repo.updateRecurringVisitPlan(plan.id, { plannedDate: input.newPlannedDate, plannedStartTime: input.newPlannedStartTime });

  await repo.insertRecurringVisitPlanHistory({
    recurringVisitPlanId: plan.id,
    recurringScheduleId: plan.recurringScheduleId,
    visitNumber: plan.visitNumber,
    previousPlannedDate: plan.plannedDate,
    previousPlannedStartTime: plan.plannedStartTime,
    previousStatus: plan.status,
    newPlannedDate: input.newPlannedDate,
    newPlannedStartTime: input.newPlannedStartTime,
    newStatus: "planned",
    changeReason: "manual_single_move",
  });

  await syncPackagePlanFromRecurringPlan(
    repo,
    { ...plan, plannedDate: input.newPlannedDate, plannedStartTime: input.newPlannedStartTime },
    "manual_single_move"
  );
}
