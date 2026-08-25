import type { SchedulingRepository } from "@/lib/scheduling/repository";
import type { ServiceVisitNotificationChannel, ServiceVisitNotificationType } from "@/lib/scheduling/types";

export interface EnqueueNotificationInput {
  /** Null only for notificationType='consent_required' — see NewServiceVisitNotificationRow's own doc comment. */
  serviceVisitId: string | null;
  customerId: string;
  notificationType: ServiceVisitNotificationType;
  channel: ServiceVisitNotificationChannel;
  scheduledSendAt: Date;
  /**
   * Distinguishes THIS logical notification occurrence so a retried
   * webhook/admin action/scheduling action/cron invocation can never create
   * a duplicate ledger row for the same business event, while a genuinely
   * NEW business event (a reschedule to a different time, a fresh
   * higher-than-before price needing approval) naturally mints a new key.
   * Convention: the confirmed_start_at ISO string for anything tied to a
   * specific appointment time; the newly computed total amount for a
   * pricing-approval notice; the active consent_version_id for
   * consent_required/consent_reminder; a fixed literal ("v1") for a type
   * that only ever fires once per visit regardless of any changing value
   * (cancelled, completed, review_request).
   */
  versionKey: string;
}

/**
 * The one server-authoritative enqueue path every notification trigger
 * point goes through. idempotency_key =
 * "{customerId}:{serviceVisitId ?? 'none'}:{notificationType}:{channel}:{versionKey}"
 * — customerId leads the key (not just serviceVisitId) because
 * consent_required can have a null serviceVisitId, and two different
 * customers' null-visit requests must never collide into the same key. The
 * unique DB constraint on service_visit_notifications.idempotency_key (see
 * its migration) makes a duplicate enqueue attempt a safe no-op, never a
 * duplicate row, regardless of which caller retries.
 */
export async function enqueueNotification(repo: SchedulingRepository, input: EnqueueNotificationInput): Promise<{ inserted: boolean }> {
  const idempotencyKey = `${input.customerId}:${input.serviceVisitId ?? "none"}:${input.notificationType}:${input.channel}:${input.versionKey}`;
  return repo.insertServiceVisitNotification({
    serviceVisitId: input.serviceVisitId,
    customerId: input.customerId,
    notificationType: input.notificationType,
    channel: input.channel,
    scheduledSendAt: input.scheduledSendAt,
    idempotencyKey,
  });
}
