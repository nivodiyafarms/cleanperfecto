import type { PackageVisitPlanRow, RecurringVisitPlanRow } from "./domain-types";
import type { SchedulingRepository } from "./repository";
import type { RecurringVisitPlanHistoryChangeReason } from "./types";

/**
 * Keeps a package_visit_plans row and its linked recurring_visit_plans row
 * (package_visit_plans.recurring_visit_plan_id) equal on planned_date/
 * planned_start_time/status/service_visit_id — called from BOTH sides
 * (admin's existing package-specific functions and the universal
 * recurring-plan functions the portal uses), so it doesn't matter which
 * "door" a change comes through: the other side is always brought into
 * agreement immediately after. A no-op when no link exists (e.g. a package
 * scheduled before this linkage existed) or when the two sides already
 * agree (avoids a redundant history row).
 */
export async function syncPackagePlanFromRecurringPlan(
  repo: SchedulingRepository,
  recurringPlan: RecurringVisitPlanRow,
  /** Never 'replenishment' — a replenished plan is by definition beyond the package's fixed 6-visit horizon and never carries a package link. */
  changeReason: Exclude<RecurringVisitPlanHistoryChangeReason, "replenishment">
): Promise<void> {
  const linked = await repo.findPackageVisitPlanByRecurringVisitPlanId(recurringPlan.id);
  if (!linked) return;
  if (
    linked.plannedDate === recurringPlan.plannedDate &&
    linked.plannedStartTime === recurringPlan.plannedStartTime &&
    linked.status === recurringPlan.status &&
    linked.serviceVisitId === recurringPlan.serviceVisitId
  ) {
    return;
  }

  await repo.updatePackageVisitPlan(linked.id, {
    plannedDate: recurringPlan.plannedDate,
    plannedStartTime: recurringPlan.plannedStartTime,
    status: recurringPlan.status,
    ...(recurringPlan.serviceVisitId ? { serviceVisitId: recurringPlan.serviceVisitId } : {}),
  });

  await repo.insertPackageVisitPlanHistory({
    packageVisitPlanId: linked.id,
    prepaidPackageId: linked.prepaidPackageId,
    visitNumber: linked.visitNumber,
    previousPlannedDate: linked.plannedDate,
    previousPlannedStartTime: linked.plannedStartTime,
    previousStatus: linked.status,
    newPlannedDate: recurringPlan.plannedDate,
    newPlannedStartTime: recurringPlan.plannedStartTime,
    newStatus: recurringPlan.status,
    changeReason,
    packageAmendmentId: null,
  });
}

/** The other direction — a change made via an admin package-specific function is mirrored onto its linked universal recurring_visit_plans row. */
export async function syncRecurringPlanFromPackagePlan(
  repo: SchedulingRepository,
  packagePlan: PackageVisitPlanRow,
  changeReason: RecurringVisitPlanHistoryChangeReason
): Promise<void> {
  if (!packagePlan.recurringVisitPlanId) return;
  const linked = await repo.findRecurringVisitPlanById(packagePlan.recurringVisitPlanId);
  if (!linked) return;
  if (
    linked.plannedDate === packagePlan.plannedDate &&
    linked.plannedStartTime === packagePlan.plannedStartTime &&
    linked.status === packagePlan.status &&
    linked.serviceVisitId === packagePlan.serviceVisitId
  ) {
    return;
  }

  await repo.updateRecurringVisitPlan(linked.id, {
    plannedDate: packagePlan.plannedDate,
    plannedStartTime: packagePlan.plannedStartTime,
    status: packagePlan.status,
    ...(packagePlan.serviceVisitId ? { serviceVisitId: packagePlan.serviceVisitId } : {}),
  });

  await repo.insertRecurringVisitPlanHistory({
    recurringVisitPlanId: linked.id,
    recurringScheduleId: linked.recurringScheduleId,
    visitNumber: linked.visitNumber,
    previousPlannedDate: linked.plannedDate,
    previousPlannedStartTime: linked.plannedStartTime,
    previousStatus: linked.status,
    newPlannedDate: packagePlan.plannedDate,
    newPlannedStartTime: packagePlan.plannedStartTime,
    newStatus: packagePlan.status,
    changeReason,
  });
}
