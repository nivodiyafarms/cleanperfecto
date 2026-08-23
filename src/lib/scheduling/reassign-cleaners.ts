import { DEFAULT_TURNAROUND_BUFFER_MINUTES } from "./config";
import { InvalidVisitStateError } from "./errors";
import type { SchedulingRepository } from "./repository";

export interface ReassignCleanersInput {
  serviceVisitId: string;
  cleanerIds: string[];
  actor?: string;
}

/**
 * Changes which cleaner(s) are assigned to an already-'scheduled' visit
 * WITHOUT changing its confirmed timing — reuses set_service_visit_schedule()
 * with the visit's own existing confirmed_start_at/end_at, so the same
 * atomic double-booking check applies to a reassignment as to an initial
 * confirmation. Covers both "assign additional/different cleaners" and
 * "reassign" — there is no separate initial-assignment step distinct from
 * confirm-service-visit.ts, which already performs the first assignment.
 */
export async function reassignCleaners(repo: SchedulingRepository, input: ReassignCleanersInput): Promise<void> {
  const visit = await repo.findServiceVisitById(input.serviceVisitId);
  if (!visit || visit.status !== "scheduled" || !visit.confirmedStartAt || !visit.confirmedEndAt) {
    throw new InvalidVisitStateError(
      `service_visit ${input.serviceVisitId} must be scheduled with confirmed timing before reassigning cleaners`
    );
  }

  await repo.setServiceVisitSchedule({
    serviceVisitId: input.serviceVisitId,
    confirmedStartAt: visit.confirmedStartAt,
    confirmedEndAt: visit.confirmedEndAt,
    estimatedLaborMinutes: visit.estimatedLaborMinutes ?? 0,
    estimatedServiceMinutes: visit.estimatedServiceMinutes ?? 0,
    recommendedCleanerCount: visit.recommendedCleanerCount ?? input.cleanerIds.length,
    turnaroundBufferMinutes: visit.turnaroundBufferMinutes ?? DEFAULT_TURNAROUND_BUFFER_MINUTES,
    cleanerIds: input.cleanerIds,
  });

  await repo.insertServiceVisitEvent({
    serviceVisitId: input.serviceVisitId,
    eventType: "cleaner_reassigned",
    actor: input.actor ?? null,
    previousState: null,
    newState: { cleanerIds: input.cleanerIds },
    notes: null,
  });
}
