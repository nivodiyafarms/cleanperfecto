import { InvalidVisitStateError } from "./errors";
import type { SchedulingRepository } from "./repository";
import { zonedDateTimeToUtc } from "./timezone";
import type { CalendarDate, TimeOfDay } from "./types";

export interface RequestVisitRescheduleInput {
  serviceVisitId: string;
  newDate: CalendarDate;
  newStartTime: TimeOfDay;
  timezone?: string;
}

/**
 * Records a CUSTOMER's request to move a real service_visits row (either
 * still-'requested', or already admin-'scheduled') to a new date/time —
 * owner-approved correction: this must never silently overwrite a confirmed
 * operational schedule. Updates ONLY requested_start_at;
 * confirmed_start_at/confirmed_end_at/status/cleaner assignments are
 * completely untouched either way. For an already-'scheduled' visit, the
 * portal derives "Reschedule requested" from requested_start_at being set
 * and different from confirmed_start_at. Admin reviews and applies it (or
 * not) via the existing, unchanged reschedule-service-visit.ts /
 * confirm-service-visit.ts flow — this function never calls
 * set_service_visit_schedule() and never assigns a cleaner.
 *
 * Only valid against a real visit ('requested' or 'scheduled') — for a
 * still-'planned' plan row with no real visit yet, there's nothing here to
 * update; use replan-recurring-visit.ts / replan-package-visit.ts instead.
 */
export async function requestVisitReschedule(repo: SchedulingRepository, input: RequestVisitRescheduleInput): Promise<void> {
  const visit = await repo.findServiceVisitById(input.serviceVisitId);
  if (!visit) {
    throw new InvalidVisitStateError(`service_visit ${input.serviceVisitId} not found`);
  }
  if (visit.status !== "requested" && visit.status !== "scheduled") {
    throw new InvalidVisitStateError(
      `service_visit ${input.serviceVisitId} is not requested or scheduled (status=${visit.status}) — a reschedule request only applies to a real, not-yet-completed/cancelled visit`
    );
  }

  const timezone = input.timezone ?? visit.timezone;
  const requestedStartAt = zonedDateTimeToUtc(input.newDate, input.newStartTime, timezone);

  await repo.updateServiceVisitRequestedStart(visit.id, requestedStartAt);

  await repo.insertServiceVisitEvent({
    serviceVisitId: visit.id,
    eventType: "reschedule_requested",
    actor: "customer",
    previousState: { confirmedStartAt: visit.confirmedStartAt?.toISOString() ?? null },
    newState: { requestedStartAt: requestedStartAt.toISOString() },
    notes: null,
  });
}
