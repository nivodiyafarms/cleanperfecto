import { dayOfWeekForDate, generateCadenceDates } from "./recurrence-dates";
import { InvalidVisitStateError } from "./errors";
import type { SchedulingRepository } from "./repository";
import type { RecurringVisitPlanRow } from "./domain-types";
import { syncPackagePlanFromRecurringPlan } from "./sync-linked-recurring-package-plan";
import type { CalendarDate, RecurringCadence, TimeOfDay } from "./types";

export interface ReplanRecurringCadenceInput {
  recurringScheduleId: string;
  /** 1-based visit number the new cadence takes effect from — every already-'linked' plan at or after this number is left untouched (it has a real, separately-reschedulable service_visit); only still-'planned' ones are regenerated. */
  effectiveFromVisitNumber: number;
  newCadence: RecurringCadence;
  newFirstDate: CalendarDate;
  newFirstStartTime: TimeOfDay;
}

/**
 * "Change this and future cleanings" for a recurring relationship —
 * universal equivalent of replan-package-cadence.ts, used for BOTH Pay Per
 * Cleaning and prepaid-package customers (owner-approved correction: this
 * capability must not be coupled exclusively to prepaid packages).
 * Regenerates every still-'planned' recurring_visit_plans row at or after
 * effectiveFromVisitNumber onto a NEW recurring_schedules version — 'linked'
 * (already-real) visits are never touched here.
 *
 * Still-'planned' rows are moved onto the new schedule id IN PLACE (their
 * visit_number is preserved, only recurring_schedule_id/plannedDate/
 * plannedStartTime change) rather than deleted-and-recreated: they were
 * never real appointments, so re-parenting them onto the new schedule
 * version carries no risk, and it avoids leaving orphaned rows behind under
 * the now-superseded schedule.
 */
export async function replanRecurringCadence(
  repo: SchedulingRepository,
  input: ReplanRecurringCadenceInput
): Promise<RecurringVisitPlanRow[]> {
  const plans = await repo.listRecurringVisitPlans(input.recurringScheduleId);
  const affected = plans.filter((p) => p.visitNumber >= input.effectiveFromVisitNumber && p.status === "planned");
  if (affected.length === 0) {
    return [];
  }

  const currentSchedule = await repo.findRecurringScheduleById(input.recurringScheduleId);
  if (!currentSchedule || currentSchedule.status !== "active") {
    throw new InvalidVisitStateError(`recurring_schedule ${input.recurringScheduleId} is not active`);
  }

  const newSchedule = await repo.insertRecurringSchedule({
    customerId: currentSchedule.customerId,
    bookingOrderId: currentSchedule.bookingOrderId,
    prepaidPackageId: currentSchedule.prepaidPackageId,
    cadence: input.newCadence,
    preferredDayOfWeek: dayOfWeekForDate(input.newFirstDate),
    preferredStartTime: input.newFirstStartTime,
    timezone: currentSchedule.timezone,
    effectiveFrom: input.newFirstDate,
    supersedesId: currentSchedule.id,
  });
  await repo.supersedeRecurringSchedule(currentSchedule.id, input.newFirstDate);

  const newDates = generateCadenceDates(input.newFirstDate, input.newCadence, affected.length);

  const updated: RecurringVisitPlanRow[] = [];
  for (let index = 0; index < affected.length; index++) {
    const plan = affected[index];
    const newDate = newDates[index];

    await repo.updateRecurringVisitPlan(plan.id, {
      plannedDate: newDate,
      plannedStartTime: input.newFirstStartTime,
      recurringScheduleId: newSchedule.id,
    });

    await repo.insertRecurringVisitPlanHistory({
      recurringVisitPlanId: plan.id,
      recurringScheduleId: newSchedule.id,
      visitNumber: plan.visitNumber,
      previousPlannedDate: plan.plannedDate,
      previousPlannedStartTime: plan.plannedStartTime,
      previousStatus: plan.status,
      newPlannedDate: newDate,
      newPlannedStartTime: input.newFirstStartTime,
      newStatus: "planned",
      changeReason: "cadence_regeneration",
    });

    const updatedPlan: RecurringVisitPlanRow = {
      ...plan,
      plannedDate: newDate,
      plannedStartTime: input.newFirstStartTime,
      recurringScheduleId: newSchedule.id,
    };
    await syncPackagePlanFromRecurringPlan(repo, updatedPlan, "cadence_regeneration");
    updated.push(updatedPlan);
  }

  return updated;
}
