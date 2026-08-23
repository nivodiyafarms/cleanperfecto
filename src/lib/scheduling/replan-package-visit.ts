import { InvalidVisitStateError } from "./errors";
import type { SchedulingRepository } from "./repository";
import type { CalendarDate, TimeOfDay } from "./types";

export interface ReplanPackageVisitInput {
  packageVisitPlanId: string;
  newPlannedDate: CalendarDate;
  newPlannedStartTime: TimeOfDay;
}

/**
 * "Change only this one planned cleaning" — moves a single, not-yet-linked
 * package_visit_plans row (visit_number and every other plan in the
 * package are untouched). Once a plan is 'linked' to a real service_visit,
 * its date lives on that visit instead — use reschedule-service-visit.ts,
 * which also handles the fee/reminder implications a real confirmed
 * appointment carries.
 */
export async function replanPackageVisit(repo: SchedulingRepository, input: ReplanPackageVisitInput): Promise<void> {
  const plan = await repo.findPackageVisitPlanById(input.packageVisitPlanId);
  if (!plan) {
    throw new InvalidVisitStateError(`package_visit_plan ${input.packageVisitPlanId} not found`);
  }
  if (plan.status !== "planned") {
    throw new InvalidVisitStateError(
      `package_visit_plan ${input.packageVisitPlanId} is already linked to a real visit — use reschedule-service-visit.ts instead`
    );
  }

  await repo.updatePackageVisitPlan(plan.id, { plannedDate: input.newPlannedDate, plannedStartTime: input.newPlannedStartTime });

  await repo.insertPackageVisitPlanHistory({
    packageVisitPlanId: plan.id,
    prepaidPackageId: plan.prepaidPackageId,
    visitNumber: plan.visitNumber,
    previousPlannedDate: plan.plannedDate,
    previousPlannedStartTime: plan.plannedStartTime,
    previousStatus: plan.status,
    newPlannedDate: input.newPlannedDate,
    newPlannedStartTime: input.newPlannedStartTime,
    newStatus: "planned",
    changeReason: "manual_single_move",
    packageAmendmentId: null,
  });
}
