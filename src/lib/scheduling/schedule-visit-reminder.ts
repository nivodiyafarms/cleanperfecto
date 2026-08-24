import { enqueueNotification } from "@/lib/notifications/enqueue-notification";
import type { SchedulingRepository } from "./repository";

const REMINDER_LEAD_HOURS = 24;

/**
 * Creates (or, thanks to the idempotency key, safely no-ops on a duplicate
 * call for) a ~24-hour-before reminder for a confirmed service_visit. Thin
 * wrapper over the general enqueueNotification path (src/lib/notifications/
 * enqueue-notification.ts) — this predates Notifications V1 and keeps its
 * existing call sites/signature shape (minus the new required customerId)
 * unchanged.
 */
export async function scheduleVisitReminder(
  repo: SchedulingRepository,
  serviceVisitId: string,
  customerId: string,
  confirmedStartAt: Date,
  channel: "email" | "sms" = "email"
): Promise<void> {
  const scheduledSendAt = new Date(confirmedStartAt.getTime() - REMINDER_LEAD_HOURS * 60 * 60 * 1000);
  await enqueueNotification(repo, {
    serviceVisitId,
    customerId,
    notificationType: "reminder_24h",
    channel,
    scheduledSendAt,
    versionKey: confirmedStartAt.toISOString(),
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
