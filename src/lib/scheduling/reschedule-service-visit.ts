import { enqueueNotification } from "@/lib/notifications/enqueue-notification";
import type { ConsentRepository } from "@/lib/consent/consent-repository";
import { scheduleConsentReminderIfUnsigned } from "@/lib/consent/schedule-consent-reminder";
import { assessFee, type FeeAssessmentResult } from "./assess-cancellation-fee";
import { DEFAULT_TURNAROUND_BUFFER_MINUTES } from "./config";
import { estimateDuration, type DurationEstimateInput } from "./duration-engine";
import { InvalidVisitStateError } from "./errors";
import type { SchedulingRepository } from "./repository";
import { cancelPendingReminder, scheduleVisitReminder } from "./schedule-visit-reminder";
import { zonedDateTimeToUtc } from "./timezone";
import type { CalendarDate, TimeOfDay } from "./types";

export interface RescheduleServiceVisitInput {
  serviceVisitId: string;
  date: CalendarDate;
  startTime: TimeOfDay;
  cleanerIds: string[];
  durationInput: DurationEstimateInput;
  /** The instant this reschedule is being requested, for fee-notice calculation — same explicit-clock pattern as calculateEstimate's asOf. */
  now: Date;
  actor?: string;
  /** Optional, same convention as confirm-service-visit.ts — omitted means no consent_reminder re-scheduling. */
  consentRepo?: ConsentRepository;
}

/**
 * Reschedules an already-'scheduled' visit — normally preserving the SAME
 * service_visits row/visit_number (never a fake replacement visit, never a
 * package-credit consumption). Assesses the reschedule fee from the notice
 * given before the visit's PREVIOUS confirmed_start_at, per the approved
 * cancellation-policy tiers, and replaces the stale pending reminder with a
 * fresh one for the new time. Re-runs the same atomic conflict check as an
 * initial confirmation via set_service_visit_schedule().
 */
export async function rescheduleServiceVisit(
  repo: SchedulingRepository,
  input: RescheduleServiceVisitInput
): Promise<FeeAssessmentResult | null> {
  const visit = await repo.findServiceVisitById(input.serviceVisitId);
  if (!visit) {
    throw new InvalidVisitStateError(`service_visit ${input.serviceVisitId} not found`);
  }
  if (visit.status !== "scheduled" || !visit.confirmedStartAt) {
    throw new InvalidVisitStateError(`service_visit ${input.serviceVisitId} is not currently scheduled — nothing to reschedule`);
  }
  const originalConfirmedStartAt = visit.confirmedStartAt;
  const originalConfirmedEndAt = visit.confirmedEndAt;

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

  const feeResult = assessFee("reschedule", input.now, originalConfirmedStartAt);
  if (feeResult.amount > 0) {
    await repo.insertServiceFeeAssessment({
      serviceVisitId: input.serviceVisitId,
      feeType: feeResult.feeType,
      amount: feeResult.amount,
      policyVersion: feeResult.policyVersion,
      reason: "Late reschedule",
    });
  }

  await repo.insertServiceVisitEvent({
    serviceVisitId: input.serviceVisitId,
    eventType: "rescheduled",
    actor: input.actor ?? null,
    previousState: {
      confirmedStartAt: originalConfirmedStartAt.toISOString(),
      confirmedEndAt: originalConfirmedEndAt?.toISOString() ?? null,
    },
    newState: { confirmedStartAt: confirmedStartAt.toISOString(), confirmedEndAt: confirmedEndAt.toISOString() },
    notes: feeResult.amount > 0 ? `Late-reschedule fee assessed: $${feeResult.amount}` : null,
  });

  await enqueueNotification(repo, {
    serviceVisitId: input.serviceVisitId,
    customerId: visit.customerId,
    notificationType: "rescheduled",
    channel: "email",
    scheduledSendAt: new Date(),
    versionKey: confirmedStartAt.toISOString(),
  });

  // Cancel-then-reschedule: the stale reminder's idempotency key is tied to
  // the OLD confirmed_start_at and would otherwise fire at the wrong time.
  await cancelPendingReminder(repo, input.serviceVisitId);
  await scheduleVisitReminder(repo, input.serviceVisitId, visit.customerId, confirmedStartAt);

  // Same cancel-then-reschedule shape for the consent reminder — cancel the
  // old pending one tied to the previous confirmed time, then enqueue a new
  // one only if consent for the active version is still unsigned.
  if (input.consentRepo) {
    await repo.cancelPendingConsentReminderForVisit(input.serviceVisitId);
    await scheduleConsentReminderIfUnsigned(repo, input.consentRepo, {
      serviceVisitId: input.serviceVisitId,
      customerId: visit.customerId,
      confirmedStartAt,
    });
  }

  return feeResult.amount > 0 ? feeResult : null;
}
