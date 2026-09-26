import { enqueueNotification } from "@/lib/notifications/enqueue-notification";
import type { ConsentRepository } from "@/lib/consent/consent-repository";
import { scheduleConsentReminderIfUnsigned } from "@/lib/consent/schedule-consent-reminder";
import { DEFAULT_TURNAROUND_BUFFER_MINUTES } from "./config";
import type { DurationEstimateInput } from "./duration-engine";
import { estimateDuration } from "./duration-engine";
import { InvalidVisitStateError, SchedulingConflictError } from "./errors";
import { findAvailableCleaners } from "./find-available-cleaners";
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
  /** Optional so every existing/new test that doesn't care about consent is unaffected — production call sites always supply it. Omitted entirely means no consent_reminder is scheduled (never a case of silently guessing signed status). */
  consentRepo?: ConsentRepository;
  /**
   * Re-validates date/startTime/cleanerIds against the exact same
   * authoritative availability engine (computeAvailableCleaners, via
   * findAvailableCleaners) the admin UI already uses to render suggested
   * AND custom start times — before writing anything. Closes the gap
   * where an admin-supplied time (suggested or custom) previously bypassed
   * every check except the DB's pure double-booking-overlap constraint,
   * which never validates cleaner working-hours, exceptions, or day
   * overrides.
   *
   * Defaults to false so every existing internal caller (recurring/package
   * auto-scheduling, which passes its own already-derived timing through a
   * different, already-audited path) is unaffected. The one caller this
   * milestone turns it on for is confirmVisitAction — the admin request
   * detail page's "Confirm appointment" action, the exact surface a
   * crafted or manually-typed custom time could otherwise reach.
   */
  requireAvailabilityCheck?: boolean;
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

  if (input.requireAvailabilityCheck) {
    const availability = await findAvailableCleaners(repo, {
      date: input.date,
      startTime: input.startTime,
      serviceMinutes: duration.estimatedServiceMinutes,
      timezone: visit.timezone,
      // A re-confirmation (visit already 'scheduled') must not see its own
      // current assignment as a conflict against itself.
      excludeServiceVisitId: input.serviceVisitId,
    });

    if (availability.closedByOverride) {
      throw new SchedulingConflictError("CleanPerfecto is closed on this date.");
    }

    const hasUnavailableSelection = input.cleanerIds.some((cleanerId) => {
      const entry = availability.cleaners.find((c) => c.cleanerId === cleanerId);
      return !entry || !entry.available;
    });
    if (hasUnavailableSelection) {
      throw new SchedulingConflictError(
        "Selected cleaner(s) are not available for this date and time — they may be outside working hours, already have a conflicting appointment, or the required scheduling buffer cannot be satisfied."
      );
    }
  }

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

  // A genuine NEW confirmation (requested -> scheduled) tells the customer
  // "you're booked." Re-confirming an already-'scheduled' visit (e.g. an
  // in-place cleaner-assignment fix via this same RPC) is not a new
  // business event and must not re-notify — see reschedule-service-visit.ts
  // for the actual "your time changed" notice.
  if (visit.status === "requested") {
    await enqueueNotification(repo, {
      serviceVisitId: input.serviceVisitId,
      customerId: visit.customerId,
      notificationType: "appointment_confirmed",
      channel: "email",
      scheduledSendAt: new Date(),
      versionKey: confirmedStartAt.toISOString(),
    });
  }

  await cancelPendingReminder(repo, input.serviceVisitId);
  await scheduleVisitReminder(repo, input.serviceVisitId, visit.customerId, confirmedStartAt);

  if (input.consentRepo) {
    await repo.cancelPendingConsentReminderForVisit(input.serviceVisitId);
    await scheduleConsentReminderIfUnsigned(repo, input.consentRepo, {
      serviceVisitId: input.serviceVisitId,
      customerId: visit.customerId,
      confirmedStartAt,
    });
  }
}
