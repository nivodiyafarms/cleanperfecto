import type { ServiceVisitNotificationRow } from "@/lib/scheduling/domain-types";
import type { SchedulingRepository } from "@/lib/scheduling/repository";
import { buildNotificationContent } from "./notification-content";
import type { NotificationRecipientContact } from "./customer-contact-lookup";
import type { CustomerNotificationPreferencesRepository } from "./customer-notification-preferences-repository";
import type { NotificationEmailSender } from "./email-sender";
import type { NotificationSmsSender } from "./sms-sender";

export type ContactLookup = (customerId: string) => Promise<NotificationRecipientContact | null>;

/** How many rows one dispatcher invocation claims — keeps a single Supabase Cron tick (or manual/disposable-validation call) comfortably within a serverless function's time budget. */
const CLAIM_BATCH_LIMIT = 25;
/** A row stuck in 'sending' longer than this (the dispatcher process died mid-send) is eligible for another worker to reclaim it — see claim_due_service_visit_notifications(). */
const STALE_CLAIM_MINUTES = 10;
/** Total failed attempts (including this one) before a row becomes terminal 'failed' rather than retried again. */
const MAX_ATTEMPTS = 5;
/** Fixed backoff between a failed attempt and its next retry — simple and predictable is enough at V1 volume; no exponential curve needed yet. */
const RETRY_BACKOFF_MINUTES = 10;

export interface DispatchDueNotificationsResult {
  claimed: number;
  sent: number;
  retried: number;
  failedTerminal: number;
}

export interface NotificationSenders {
  email: NotificationEmailSender;
  sms: NotificationSmsSender;
}

async function recordOutcome(
  repo: SchedulingRepository,
  now: Date,
  notification: ServiceVisitNotificationRow,
  outcome: { sent: boolean; providerMessageId?: string | null; failureReason?: string },
  result: DispatchDueNotificationsResult
): Promise<void> {
  if (outcome.sent) {
    await repo.markServiceVisitNotificationSent(notification.id, outcome.providerMessageId ?? null);
    result.sent += 1;
    return;
  }

  const failureReason = outcome.failureReason ?? "unknown failure";
  const attemptsSoFar = notification.retryCount + 1;
  if (attemptsSoFar >= MAX_ATTEMPTS) {
    await repo.markServiceVisitNotificationFailedTerminal(notification.id, failureReason);
    result.failedTerminal += 1;
    return;
  }

  const nextScheduledSendAt = new Date(now.getTime() + RETRY_BACKOFF_MINUTES * 60_000);
  await repo.markServiceVisitNotificationRetry(notification.id, { failureReason, nextScheduledSendAt });
  result.retried += 1;
}

/**
 * The dispatch worker — invoked by the Supabase Cron -> /api/cron/dispatch-
 * notifications route every 5 minutes (and manually, with fake senders,
 * during disposable validation; see that route for the secret-auth gate).
 *
 * Claims a batch atomically (claim_due_service_visit_notifications — due-
 * pending rows AND stale-'sending' rows from a worker that died mid-send),
 * then for each row: resolves the customer's CURRENT contact info fresh
 * (never a stale enqueue-time snapshot), builds content, sends via the
 * appropriate channel sender, and records the outcome. An sms-channel row
 * is never sent without the customer's current sms_opt_in — checked here,
 * at send time, not merely at enqueue time. Never converts an uncertain
 * result (a thrown error, a provider timeout) into 'sent' — anything that
 * isn't an explicit { sent: true } is treated as a failure and goes through
 * the same capped-retry path.
 *
 * contactLookup is injected (rather than importing customer-contact-
 * lookup.ts directly) so this whole worker is unit-testable against the
 * fake scheduling repository without any real Supabase connection — the
 * cron route passes the real getNotificationRecipientContact.
 */
export async function dispatchDueNotifications(
  repo: SchedulingRepository,
  preferencesRepo: CustomerNotificationPreferencesRepository,
  senders: NotificationSenders,
  contactLookup: ContactLookup,
  now: Date = new Date()
): Promise<DispatchDueNotificationsResult> {
  const claimed = await repo.claimDueServiceVisitNotifications(CLAIM_BATCH_LIMIT, STALE_CLAIM_MINUTES);
  const result: DispatchDueNotificationsResult = { claimed: claimed.length, sent: 0, retried: 0, failedTerminal: 0 };

  for (const notification of claimed) {
    try {
      if (notification.channel === "sms") {
        const prefs = await preferencesRepo.findByCustomerId(notification.customerId);
        if (!prefs?.smsOptIn) {
          // Not a transient failure — retrying won't change an opt-in
          // decision. Terminal immediately, no real send ever attempted.
          await repo.markServiceVisitNotificationFailedTerminal(notification.id, "sms_opt_in not granted");
          result.failedTerminal += 1;
          continue;
        }
      }

      const [contact, visit] = await Promise.all([contactLookup(notification.customerId), repo.findServiceVisitById(notification.serviceVisitId)]);

      const content = buildNotificationContent({
        notificationType: notification.notificationType,
        customerName: contact?.name ?? "there",
        visitStartAtUtc: visit?.confirmedStartAt ?? null,
        timezone: visit?.timezone ?? "America/Chicago",
      });

      let outcome: { sent: boolean; providerMessageId?: string | null; failureReason?: string };
      if (notification.channel === "email") {
        outcome = !contact?.email
          ? { sent: false, failureReason: "customer has no email on file" }
          : await senders.email.send({ to: contact.email, subject: content.subject, text: content.text, html: content.html, idempotencyKey: notification.idempotencyKey });
      } else {
        outcome = !contact?.phone
          ? { sent: false, failureReason: "customer has no phone on file" }
          : await senders.sms.send({ to: contact.phone, body: content.smsBody, idempotencyKey: notification.idempotencyKey });
      }

      await recordOutcome(repo, now, notification, outcome, result);
    } catch (err) {
      const failureReason = err instanceof Error ? err.message : "unknown error";
      await recordOutcome(repo, now, notification, { sent: false, failureReason }, result);
    }
  }

  return result;
}
