import { RECURRING_VISIT_PLAN_HORIZON } from "./plan-recurring-visit-dates";
import { addCadenceInterval } from "./recurrence-dates";
import type { SchedulingRepository } from "./repository";
import type { RecurringVisitPlanRow } from "./domain-types";

/**
 * Tops the rolling next-six-cleanings horizon back up after a service_visit
 * under this recurring_schedule completes or is cancelled — called as a
 * follow-up step right after that transition (no cron/background-job infra
 * exists in this codebase; this mirrors the existing pattern of doing
 * follow-up work inline, e.g. rescheduling the 24h reminder on confirm).
 * Never creates fake service_visits — only recurring_visit_plans rows,
 * exactly like the initial planning step. A schedule that is
 * paused/superseded/cancelled is never replenished.
 *
 * "Outstanding" (still counts toward the 6-slot horizon) means: a
 * still-'planned' row, OR a 'linked' row whose real service_visit hasn't
 * completed or been cancelled yet. A linked row whose visit already
 * completed/cancelled no longer occupies a horizon slot — that's exactly
 * what creates the deficit this function fills.
 */
export async function replenishRecurringVisitPlans(
  repo: SchedulingRepository,
  recurringScheduleId: string
): Promise<RecurringVisitPlanRow[]> {
  const schedule = await repo.findRecurringScheduleById(recurringScheduleId);
  if (!schedule || schedule.status !== "active") {
    return [];
  }

  const plans = await repo.listRecurringVisitPlans(recurringScheduleId);

  let outstandingCount = 0;
  for (const p of plans) {
    if (p.status === "planned") {
      outstandingCount += 1;
      continue;
    }
    if (p.status === "linked" && p.serviceVisitId) {
      const visit = await repo.findServiceVisitById(p.serviceVisitId);
      if (visit && visit.status !== "completed" && visit.status !== "cancelled") {
        outstandingCount += 1;
      }
    }
  }

  const deficit = RECURRING_VISIT_PLAN_HORIZON - outstandingCount;
  if (deficit <= 0) {
    return [];
  }

  const lastVisitNumber = plans.length > 0 ? Math.max(...plans.map((p) => p.visitNumber)) : 0;
  const lastDate = plans.reduce<string | null>(
    (latest, p) => (latest === null || p.plannedDate > latest ? p.plannedDate : latest),
    null
  );
  let cursor = lastDate ?? schedule.effectiveFrom;

  const created: RecurringVisitPlanRow[] = [];
  for (let i = 0; i < deficit; i++) {
    cursor = addCadenceInterval(cursor, schedule.cadence);
    const visitNumber = lastVisitNumber + i + 1;
    const { plan, inserted } = await repo.insertRecurringVisitPlan({
      recurringScheduleId,
      customerId: schedule.customerId,
      visitNumber,
      plannedDate: cursor,
      plannedStartTime: schedule.preferredStartTime,
    });
    if (inserted) {
      await repo.insertRecurringVisitPlanHistory({
        recurringVisitPlanId: plan.id,
        recurringScheduleId,
        visitNumber,
        previousPlannedDate: null,
        previousPlannedStartTime: null,
        previousStatus: null,
        newPlannedDate: plan.plannedDate,
        newPlannedStartTime: plan.plannedStartTime,
        newStatus: "planned",
        changeReason: "replenishment",
      });
    }
    created.push(plan);
  }

  return created;
}
