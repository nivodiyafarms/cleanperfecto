import { InvalidVisitStateError } from "./errors";
import { generateCadenceDates } from "./recurrence-dates";
import type { SchedulingRepository } from "./repository";
import type { RecurringVisitPlanRow } from "./domain-types";
import type { CalendarDate, RecurringCadence, TimeOfDay } from "./types";

/**
 * The rolling horizon size every active recurring customer is kept topped
 * up to — fixed at 6 regardless of payment model (owner-approved
 * correction: the customer-facing calendar must not depend on whether the
 * customer pays per cleaning or is on a prepaid package).
 */
export const RECURRING_VISIT_PLAN_HORIZON = 6;

export interface PlanRecurringVisitDatesInput {
  recurringScheduleId: string;
  customerId: string;
  cadence: RecurringCadence;
  firstDate: CalendarDate;
  firstStartTime: TimeOfDay;
}

/**
 * Seeds the universal rolling next-six-cleanings calendar for a
 * recurring_schedules row — the customer-portal-facing planning layer used
 * for BOTH Pay Per Cleaning and prepaid-package customers (see
 * recurring_visit_plans' own migration comment for why this is a separate
 * table from package_visit_plans, not a replacement for it — that table
 * remains intact and unchanged for existing package fulfillment history).
 * Idempotent: if plans already exist for this schedule, returns them
 * unchanged — use replan-recurring-visit.ts / replan-recurring-cadence.ts to
 * change an established plan, and replenish-recurring-visit-plans.ts to
 * extend the horizon after a completed/cancelled occurrence.
 */
export async function planRecurringVisitDates(
  repo: SchedulingRepository,
  input: PlanRecurringVisitDatesInput
): Promise<RecurringVisitPlanRow[]> {
  const schedule = await repo.findRecurringScheduleById(input.recurringScheduleId);
  if (!schedule) {
    throw new InvalidVisitStateError(`recurring_schedule ${input.recurringScheduleId} not found`);
  }

  const existingPlans = await repo.listRecurringVisitPlans(input.recurringScheduleId);
  if (existingPlans.length > 0) {
    return existingPlans;
  }

  const dates = generateCadenceDates(input.firstDate, input.cadence, RECURRING_VISIT_PLAN_HORIZON);

  const plans: RecurringVisitPlanRow[] = [];
  for (let index = 0; index < dates.length; index++) {
    const visitNumber = index + 1;
    const { plan, inserted } = await repo.insertRecurringVisitPlan({
      recurringScheduleId: input.recurringScheduleId,
      customerId: input.customerId,
      visitNumber,
      plannedDate: dates[index],
      plannedStartTime: input.firstStartTime,
    });
    if (inserted) {
      await repo.insertRecurringVisitPlanHistory({
        recurringVisitPlanId: plan.id,
        recurringScheduleId: input.recurringScheduleId,
        visitNumber,
        previousPlannedDate: null,
        previousPlannedStartTime: null,
        previousStatus: null,
        newPlannedDate: plan.plannedDate,
        newPlannedStartTime: plan.plannedStartTime,
        newStatus: "planned",
        changeReason: "initial_plan",
      });
    }
    plans.push(plan);
  }

  return plans;
}
