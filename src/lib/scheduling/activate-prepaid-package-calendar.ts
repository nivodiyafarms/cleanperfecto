import type { PackageVisitPlanRow, RecurringVisitPlanRow } from "./domain-types";
import { InvalidVisitStateError } from "./errors";
import { planPackageVisitDates } from "./plan-package-visit-dates";
import { planRecurringVisitDates } from "./plan-recurring-visit-dates";
import type { SchedulingRepository } from "./repository";
import type { CalendarDate, RecurringCadence, TimeOfDay } from "./types";

export interface ActivatePrepaidPackageCalendarInput {
  prepaidPackageId: string;
  customerId: string;
  cadence: RecurringCadence;
  firstDate: CalendarDate;
  firstStartTime: TimeOfDay;
  timezone?: string;
}

export interface ActivatePrepaidPackageCalendarResult {
  packagePlans: PackageVisitPlanRow[];
  recurringPlans: RecurringVisitPlanRow[];
}

/**
 * The real server-authoritative event where a prepaid package's future
 * cleaning dates become known — deliberately NOT the payment webhook.
 * booking_orders_prepaid_has_no_schedule_fields means a prepaid_package
 * booking_order carries no requested date/time at all, so no first
 * date/time exists yet at payment-verification time; it's supplied later,
 * via the existing explicit planning step (today, an admin action calling
 * this instead of calling planPackageVisitDates directly — see
 * planPackageVisitDatesAction). No new payment semantics invented.
 *
 * Refuses to run against a package that isn't legitimately active
 * (payment already verified via the existing Stripe webhook rules —
 * activatePrepaidPackage only ever inserts a package as 'active').
 *
 * Creates BOTH the existing, unchanged package_visit_plans (fulfillment/
 * credit-planning history) AND the universal recurring_visit_plans
 * calendar from the SAME cadence/first-date inputs, then links each pair
 * by visit_number (package_visit_plans.recurring_visit_plan_id) so the two
 * can never independently drift for the same occurrence — see
 * sync-linked-recurring-package-plan.ts for what keeps them in sync
 * afterward.
 *
 * Fully idempotent: planPackageVisitDates/planRecurringVisitDates are each
 * independently idempotent (a Stripe/admin retry is a safe no-op), and the
 * linking loop only sets a link that isn't already set.
 */
export async function activatePrepaidPackageCalendar(
  repo: SchedulingRepository,
  input: ActivatePrepaidPackageCalendarInput
): Promise<ActivatePrepaidPackageCalendarResult> {
  const pkg = await repo.findPrepaidPackageById(input.prepaidPackageId);
  if (!pkg) {
    throw new InvalidVisitStateError(`prepaid_package ${input.prepaidPackageId} not found`);
  }
  if (pkg.status !== "active") {
    throw new InvalidVisitStateError(
      `prepaid_package ${input.prepaidPackageId} is not active (status=${pkg.status}) — scheduling cannot activate until payment is verified`
    );
  }

  const packagePlans = await planPackageVisitDates(repo, {
    prepaidPackageId: input.prepaidPackageId,
    customerId: input.customerId,
    cadence: input.cadence,
    firstDate: input.firstDate,
    firstStartTime: input.firstStartTime,
    timezone: input.timezone,
  });

  const schedule = await repo.findActiveRecurringScheduleForPackage(input.prepaidPackageId);
  if (!schedule) {
    throw new InvalidVisitStateError(
      `recurring_schedule for prepaid_package ${input.prepaidPackageId} was not created as expected by planPackageVisitDates`
    );
  }

  const recurringPlans = await planRecurringVisitDates(repo, {
    recurringScheduleId: schedule.id,
    customerId: input.customerId,
    cadence: input.cadence,
    firstDate: input.firstDate,
    firstStartTime: input.firstStartTime,
  });

  for (const packagePlan of packagePlans) {
    if (packagePlan.recurringVisitPlanId) continue;
    const match = recurringPlans.find((p) => p.visitNumber === packagePlan.visitNumber);
    if (match) {
      await repo.updatePackageVisitPlan(packagePlan.id, { recurringVisitPlanId: match.id });
    }
  }

  return { packagePlans, recurringPlans };
}
