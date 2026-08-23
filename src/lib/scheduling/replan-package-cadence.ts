import { dayOfWeekForDate, generateCadenceDates } from "./recurrence-dates";
import type { SchedulingRepository } from "./repository";
import type { PackageVisitPlanRow } from "./domain-types";
import type { CalendarDate, RecurringCadence, TimeOfDay } from "./types";

export interface ReplanPackageCadenceInput {
  prepaidPackageId: string;
  /** 1-based visit number the new cadence takes effect from — every already-'linked' plan at or after this number is left untouched (it has a real, separately-reschedulable service_visit); only still-'planned' ones are regenerated. */
  effectiveFromVisitNumber: number;
  newCadence: RecurringCadence;
  newFirstDate: CalendarDate;
  newFirstStartTime: TimeOfDay;
  /** Set when this regeneration was driven by an approved package_amendments row, so the history trail is traceable to it. */
  packageAmendmentId?: string | null;
}

/**
 * "Change this and future cleanings" for a prepaid package: regenerates
 * the planned dates for every still-'planned' visit at or after
 * effectiveFromVisitNumber using the new cadence, starting from
 * newFirstDate. Completed/linked visits are never touched here — only the
 * planning-stage rows. Also versions the package's recurring_schedules row
 * (supersedes the old one), the same mechanism used for a normal
 * recurring booking's "this and future" change.
 */
export async function replanPackageCadence(
  repo: SchedulingRepository,
  input: ReplanPackageCadenceInput
): Promise<PackageVisitPlanRow[]> {
  const plans = await repo.listPackageVisitPlans(input.prepaidPackageId);
  const affected = plans.filter((p) => p.visitNumber >= input.effectiveFromVisitNumber && p.status === "planned");
  if (affected.length === 0) {
    return [];
  }

  const currentSchedule = await repo.findActiveRecurringScheduleForPackage(input.prepaidPackageId);
  let newScheduleId: string | null = null;
  if (currentSchedule) {
    const created = await repo.insertRecurringSchedule({
      customerId: currentSchedule.customerId,
      bookingOrderId: null,
      prepaidPackageId: input.prepaidPackageId,
      cadence: input.newCadence,
      preferredDayOfWeek: dayOfWeekForDate(input.newFirstDate),
      preferredStartTime: input.newFirstStartTime,
      timezone: currentSchedule.timezone,
      effectiveFrom: input.newFirstDate,
      supersedesId: currentSchedule.id,
    });
    await repo.supersedeRecurringSchedule(currentSchedule.id, input.newFirstDate);
    newScheduleId = created.id;
  }

  const newDates = generateCadenceDates(input.newFirstDate, input.newCadence, affected.length);

  const updated: PackageVisitPlanRow[] = [];
  for (let index = 0; index < affected.length; index++) {
    const plan = affected[index];
    const newDate = newDates[index];

    await repo.updatePackageVisitPlan(plan.id, { plannedDate: newDate, plannedStartTime: input.newFirstStartTime });

    await repo.insertPackageVisitPlanHistory({
      packageVisitPlanId: plan.id,
      prepaidPackageId: input.prepaidPackageId,
      visitNumber: plan.visitNumber,
      previousPlannedDate: plan.plannedDate,
      previousPlannedStartTime: plan.plannedStartTime,
      previousStatus: plan.status,
      newPlannedDate: newDate,
      newPlannedStartTime: input.newFirstStartTime,
      newStatus: "planned",
      changeReason: "cadence_regeneration",
      packageAmendmentId: input.packageAmendmentId ?? null,
    });

    updated.push({
      ...plan,
      plannedDate: newDate,
      plannedStartTime: input.newFirstStartTime,
      generatedFromRecurringScheduleId: newScheduleId ?? plan.generatedFromRecurringScheduleId,
    });
  }

  return updated;
}
