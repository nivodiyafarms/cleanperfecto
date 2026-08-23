import { InvalidVisitStateError } from "./errors";
import { dayOfWeekForDate, generateCadenceDates } from "./recurrence-dates";
import type { SchedulingRepository } from "./repository";
import type { PackageVisitPlanRow } from "./domain-types";
import type { CalendarDate, RecurringCadence, TimeOfDay } from "./types";

const DEFAULT_TIMEZONE = "America/Chicago";

export interface PlanPackageVisitDatesInput {
  prepaidPackageId: string;
  customerId: string;
  cadence: RecurringCadence;
  firstDate: CalendarDate;
  firstStartTime: TimeOfDay;
  timezone?: string;
}

/**
 * Lets a prepaid-package customer plan/review all of their package's
 * intended cleaning dates upfront — cadence + first date -> N proposed
 * dates (N = the package's own purchasedVisitCount, never hardcoded to 6)
 * — WITHOUT creating any real service_visits rows (those are created only
 * when a specific planned visit is actually scheduled — see
 * schedule-package-visit-plan.ts). A deliberately separate, later, explicit
 * action from the package PURCHASE itself (which never calls this).
 * Idempotent: if plans already exist for this package, returns them
 * unchanged rather than creating a second set — use
 * replan-package-visit.ts / replan-package-cadence.ts to change an
 * established plan.
 */
export async function planPackageVisitDates(
  repo: SchedulingRepository,
  input: PlanPackageVisitDatesInput
): Promise<PackageVisitPlanRow[]> {
  const pkg = await repo.findPrepaidPackageById(input.prepaidPackageId);
  if (!pkg) {
    throw new InvalidVisitStateError(`prepaid_package ${input.prepaidPackageId} not found`);
  }

  const existingPlans = await repo.listPackageVisitPlans(input.prepaidPackageId);
  if (existingPlans.length > 0) {
    return existingPlans;
  }

  const timezone = input.timezone ?? DEFAULT_TIMEZONE;

  let schedule = await repo.findActiveRecurringScheduleForPackage(input.prepaidPackageId);
  if (!schedule) {
    schedule = await repo.insertRecurringSchedule({
      customerId: input.customerId,
      bookingOrderId: null,
      prepaidPackageId: input.prepaidPackageId,
      cadence: input.cadence,
      preferredDayOfWeek: dayOfWeekForDate(input.firstDate),
      preferredStartTime: input.firstStartTime,
      timezone,
      effectiveFrom: input.firstDate,
      supersedesId: null,
    });
  }

  const dates = generateCadenceDates(input.firstDate, input.cadence, pkg.purchasedVisitCount);

  const plans: PackageVisitPlanRow[] = [];
  for (let index = 0; index < dates.length; index++) {
    const visitNumber = index + 1;
    const { plan, inserted } = await repo.insertPackageVisitPlan({
      prepaidPackageId: input.prepaidPackageId,
      visitNumber,
      plannedDate: dates[index],
      plannedStartTime: input.firstStartTime,
      generatedFromRecurringScheduleId: schedule.id,
    });
    if (inserted) {
      await repo.insertPackageVisitPlanHistory({
        packageVisitPlanId: plan.id,
        prepaidPackageId: input.prepaidPackageId,
        visitNumber,
        previousPlannedDate: null,
        previousPlannedStartTime: null,
        previousStatus: null,
        newPlannedDate: plan.plannedDate,
        newPlannedStartTime: plan.plannedStartTime,
        newStatus: "planned",
        changeReason: "initial_plan",
        packageAmendmentId: null,
      });
    }
    plans.push(plan);
  }

  return plans;
}
