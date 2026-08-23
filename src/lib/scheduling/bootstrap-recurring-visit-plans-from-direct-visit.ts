import type { RecurringVisitPlanRow } from "./domain-types";
import { RECURRING_VISIT_PLAN_HORIZON } from "./plan-recurring-visit-dates";
import { addCadenceInterval, generateCadenceDates } from "./recurrence-dates";
import type { SchedulingRepository } from "./repository";
import type { CalendarDate, RecurringCadence, TimeOfDay } from "./types";

export interface BootstrapRecurringVisitPlansFromDirectVisitInput {
  recurringScheduleId: string;
  customerId: string;
  cadence: RecurringCadence;
  firstDate: CalendarDate;
  firstStartTime: TimeOfDay;
  /** The already-created direct service_visits row for this booking (see create-requested-visit-from-booking.ts) — occupies universal calendar slot #1, immediately 'linked'. */
  directServiceVisitId: string;
}

/**
 * Seeds the universal next-six calendar for a Pay Per Cleaning recurring
 * booking, called right after a normal booking's setup payment succeeds
 * (see the integration point in process-stripe-webhook-event.ts) — the
 * real server-authoritative event where a recurring relationship becomes
 * active, using the requested date/time + cadence already established by
 * the existing booking architecture. No new payment semantics invented.
 *
 * Unlike a fresh prepaid-package calendar (see
 * activate-prepaid-package-calendar.ts / plan-recurring-visit-dates.ts,
 * where every slot starts 'planned'), a normal booking ALREADY has a real
 * service_visits row the moment setup succeeds (create-requested-visit-
 * from-booking.ts) — so slot #1 here starts pre-'linked' to that visit,
 * and only slots #2-6 are generated as 'planned'. This is what makes the
 * customer's just-booked first cleaning show up in "next six" at all.
 *
 * Idempotent: if plans already exist for this schedule, returns them
 * unchanged (safe against a Stripe webhook retry).
 */
export async function bootstrapRecurringVisitPlansFromDirectVisit(
  repo: SchedulingRepository,
  input: BootstrapRecurringVisitPlansFromDirectVisitInput
): Promise<RecurringVisitPlanRow[]> {
  const existingPlans = await repo.listRecurringVisitPlans(input.recurringScheduleId);
  if (existingPlans.length > 0) {
    return existingPlans;
  }

  const plans: RecurringVisitPlanRow[] = [];

  const { plan: firstPlan, inserted: firstInserted } = await repo.insertRecurringVisitPlan({
    recurringScheduleId: input.recurringScheduleId,
    customerId: input.customerId,
    visitNumber: 1,
    plannedDate: input.firstDate,
    plannedStartTime: input.firstStartTime,
  });
  if (firstInserted) {
    await repo.insertRecurringVisitPlanHistory({
      recurringVisitPlanId: firstPlan.id,
      recurringScheduleId: input.recurringScheduleId,
      visitNumber: 1,
      previousPlannedDate: null,
      previousPlannedStartTime: null,
      previousStatus: null,
      newPlannedDate: firstPlan.plannedDate,
      newPlannedStartTime: firstPlan.plannedStartTime,
      newStatus: "planned",
      changeReason: "initial_plan",
    });
    await repo.updateRecurringVisitPlan(firstPlan.id, { status: "linked", serviceVisitId: input.directServiceVisitId });
    await repo.insertRecurringVisitPlanHistory({
      recurringVisitPlanId: firstPlan.id,
      recurringScheduleId: input.recurringScheduleId,
      visitNumber: 1,
      previousPlannedDate: firstPlan.plannedDate,
      previousPlannedStartTime: firstPlan.plannedStartTime,
      previousStatus: "planned",
      newPlannedDate: firstPlan.plannedDate,
      newPlannedStartTime: firstPlan.plannedStartTime,
      newStatus: "linked",
      changeReason: "linked_to_visit",
    });
  }
  plans.push({ ...firstPlan, status: "linked", serviceVisitId: input.directServiceVisitId });

  const remainingCount = RECURRING_VISIT_PLAN_HORIZON - 1;
  const secondDate = addCadenceInterval(input.firstDate, input.cadence);
  const remainingDates = generateCadenceDates(secondDate, input.cadence, remainingCount);

  for (let index = 0; index < remainingDates.length; index++) {
    const visitNumber = index + 2;
    const { plan, inserted } = await repo.insertRecurringVisitPlan({
      recurringScheduleId: input.recurringScheduleId,
      customerId: input.customerId,
      visitNumber,
      plannedDate: remainingDates[index],
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
