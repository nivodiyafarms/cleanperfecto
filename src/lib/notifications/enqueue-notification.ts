import type { SchedulingRepository } from "@/lib/scheduling/repository";
import type { ServiceVisitNotificationChannel, ServiceVisitNotificationType } from "@/lib/scheduling/types";

export interface EnqueueNotificationInput {
  serviceVisitId: string;
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
   * pricing-approval notice; a fixed literal ("v1") for a type that only
   * ever fires once per visit regardless of any changing value (cancelled,
   * completed).
   */
  versionKey: string;
}

/**
 * The one server-authoritative enqueue path every notification trigger
 * point goes through (the existing 24h reminder via schedule-visit-
 * reminder.ts, and every new V1 type). idempotency_key =
 * "{serviceVisitId}:{notificationType}:{channel}:{versionKey}" — the
 * unique DB constraint on service_visit_notifications.idempotency_key
 * (see its migration) makes a duplicate enqueue attempt a safe no-op,
 * never a duplicate row, regardless of which caller retries.
 */
export async function enqueueNotification(repo: SchedulingRepository, input: EnqueueNotificationInput): Promise<{ inserted: boolean }> {
  const idempotencyKey = `${input.serviceVisitId}:${input.notificationType}:${input.channel}:${input.versionKey}`;
  return repo.insertServiceVisitNotification({
    serviceVisitId: input.serviceVisitId,
    customerId: input.customerId,
    notificationType: input.notificationType,
    channel: input.channel,
    scheduledSendAt: input.scheduledSendAt,
    idempotencyKey,
  });
}
