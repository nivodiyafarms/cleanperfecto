import { enqueueNotification } from "@/lib/notifications/enqueue-notification";
import type { SchedulingRepository } from "@/lib/scheduling/repository";
import type { ConsentRepository } from "./consent-repository";

export interface ScheduleConsentReminderInput {
  serviceVisitId: string;
  customerId: string;
  confirmedStartAt: Date;
  /** Injected for deterministic tests; defaults to the real clock. */
  now?: Date;
}

/**
 * Enqueues a consent_reminder for a confirmed visit — but ONLY if the
 * customer has not already signed the currently active consent version
 * (checked fresh here, not cached). A no-op if already signed, or if no
 * consent_versions is active at all.
 *
 * Normal timing: confirmed_start_at - 24h, same math as the operational
 * reminder_24h. If that instant is already in the past relative to `now`
 * (the visit was confirmed less than 24 hours before service), the
 * reminder becomes immediately eligible instead of scheduled into the
 * past — max(confirmedStartAt - 24h, now).
 *
 * versionKey is always confirmedStartAt's ISO string (never `now`), so a
 * retried confirmation of the SAME time is idempotent regardless of which
 * of the two branches above computed scheduledSendAt — see
 * enqueue-notification.ts.
 *
 * Callers cancel any stale pending consent_reminder for this visit FIRST
 * (schedulingRepo.cancelPendingConsentReminderForVisit) — this function
 * only ever creates, never cancels.
 */
export async function scheduleConsentReminderIfUnsigned(
  schedulingRepo: SchedulingRepository,
  consentRepo: ConsentRepository,
  input: ScheduleConsentReminderInput
): Promise<void> {
  const activeVersion = await consentRepo.findActiveVersion();
  if (!activeVersion) return;

  const record = await consentRepo.findByCustomerAndVersion(input.customerId, activeVersion.id);
  if (record?.state === "signed") return;

  const now = input.now ?? new Date();
  const twentyFourHoursBefore = new Date(input.confirmedStartAt.getTime() - 24 * 60 * 60 * 1000);
  const scheduledSendAt = twentyFourHoursBefore.getTime() > now.getTime() ? twentyFourHoursBefore : now;

  await enqueueNotification(schedulingRepo, {
    serviceVisitId: input.serviceVisitId,
    customerId: input.customerId,
    notificationType: "consent_reminder",
    channel: "email",
    scheduledSendAt,
    versionKey: input.confirmedStartAt.toISOString(),
  });
}
