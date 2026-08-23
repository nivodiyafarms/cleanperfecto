import { DEFAULT_TURNAROUND_BUFFER_MINUTES } from "./config";
import type { DurationEstimateInput } from "./duration-engine";
import { estimateDuration } from "./duration-engine";
import { InvalidVisitStateError } from "./errors";
import type { SchedulingRepository } from "./repository";
import { cancelPendingReminder, scheduleVisitReminder } from "./schedule-visit-reminder";
import { zonedDateTimeToUtc } from "./timezone";
import type { CalendarDate, TimeOfDay } from "./types";

export interface ConfirmServiceVisitInput {
  serviceVisitId: string;
  date: CalendarDate;
  startTime: TimeOfDay;
  cleanerIds: string[];
  durationInput: DurationEstimateInput;
  actor?: string;
}

/**
 * Confirms a 'requested' visit (or re-confirms a 'scheduled' one — the
 * underlying set_service_visit_schedule() RPC handles both): computes the
 * tentative duration/staffing estimate, converts the chosen local
 * date/time to a timezone-safe UTC instant, and atomically writes the
 * confirmed fields + cleaner assignment(s). A SchedulingConflictError from
 * the repository (a genuine double-booking caught by the DB EXCLUDE
 * constraint) propagates to the caller unchanged — see errors.ts.
 */
export async function confirmServiceVisit(repo: SchedulingRepository, input: ConfirmServiceVisitInput): Promise<void> {
  const visit = await repo.findServiceVisitById(input.serviceVisitId);
  if (!visit) {
    throw new InvalidVisitStateError(`service_visit ${input.serviceVisitId} not found`);
  }
  if (visit.status !== "requested" && visit.status !== "scheduled") {
    throw new InvalidVisitStateError(`service_visit ${input.serviceVisitId} is not in a confirmable state (status=${visit.status})`);
  }

  const duration = estimateDuration(input.durationInput);
  const confirmedStartAt = zonedDateTimeToUtc(input.date, input.startTime, visit.timezone);
  const confirmedEndAt = new Date(confirmedStartAt.getTime() + duration.estimatedServiceMinutes * 60_000);

  await repo.setServiceVisitSchedule({
    serviceVisitId: input.serviceVisitId,
    confirmedStartAt,
    confirmedEndAt,
    estimatedLaborMinutes: duration.estimatedLaborMinutes,
    estimatedServiceMinutes: duration.estimatedServiceMinutes,
    recommendedCleanerCount: duration.recommendedCleanerCount,
    turnaroundBufferMinutes: DEFAULT_TURNAROUND_BUFFER_MINUTES,
    cleanerIds: input.cleanerIds,
  });

  await repo.insertServiceVisitEvent({
    serviceVisitId: input.serviceVisitId,
    eventType: "confirmed",
    actor: input.actor ?? null,
    previousState: { status: visit.status },
    newState: {
      confirmedStartAt: confirmedStartAt.toISOString(),
      confirmedEndAt: confirmedEndAt.toISOString(),
      cleanerIds: input.cleanerIds,
    },
    notes: null,
  });

  await cancelPendingReminder(repo, input.serviceVisitId);
  await scheduleVisitReminder(repo, input.serviceVisitId, confirmedStartAt);
}
