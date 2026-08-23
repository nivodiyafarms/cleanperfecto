import type { SchedulingRepository } from "./repository";

const REMINDER_LEAD_HOURS = 24;

/**
 * Creates (or, thanks to the idempotency key, safely no-ops on a duplicate
 * call for) a ~24-hour-before reminder for a confirmed service_visit. No
 * dispatch/send mechanism exists yet in this milestone — see
 * service_visit_notifications' migration comment — this only maintains the
 * pending-reminder row's lifecycle.
 */
export async function scheduleVisitReminder(
  repo: SchedulingRepository,
  serviceVisitId: string,
  confirmedStartAt: Date,
  channel: "email" | "sms" = "email"
): Promise<void> {
  const scheduledSendAt = new Date(confirmedStartAt.getTime() - REMINDER_LEAD_HOURS * 60 * 60 * 1000);
  const idempotencyKey = `${serviceVisitId}:reminder_24h:${channel}:${confirmedStartAt.toISOString()}`;
  await repo.insertServiceVisitNotification({
    serviceVisitId,
    notificationType: "reminder_24h",
    channel,
    scheduledSendAt,
    idempotencyKey,
  });
}

/**
 * Cancels any still-pending reminder for a visit — called before
 * rescheduling (the stale reminder's idempotency key is tied to the OLD
 * confirmed_start_at and would otherwise fire at the wrong time) and on
 * cancellation/completion (no reminder should ever fire for either).
 */
export async function cancelPendingReminder(repo: SchedulingRepository, serviceVisitId: string): Promise<void> {
  await repo.cancelPendingServiceVisitNotifications(serviceVisitId);
}
