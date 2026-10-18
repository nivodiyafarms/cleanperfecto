import "server-only";

import type { CustomerAuthLinkGenerator } from "@/lib/customer-portal/customer-auth-link";
import type { NotificationEmailSender } from "@/lib/notifications/email-sender";
import type { NotificationRecipientContact } from "@/lib/notifications/customer-contact-lookup";
import { buildNotificationContent } from "@/lib/notifications/notification-content";
import { RETRY_BACKOFF_MS, SEND_MAX_ATTEMPTS, sendNotificationEmailWithRetry } from "@/lib/notifications/send-notification-with-retry";
import type { SchedulingRepository } from "./repository";

function realSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface SendFinalTotalReadyImmediatelyDeps {
  repo: SchedulingRepository;
  contactLookup: (customerId: string) => Promise<NotificationRecipientContact | null>;
  authLinkGenerator: CustomerAuthLinkGenerator;
  emailSender: NotificationEmailSender;
  /** Injectable clock — defaults to the real one; tests pin it for determinism. */
  now?: () => Date;
  /** Injectable backoff delay — defaults to a real setTimeout; tests pass a no-op. */
  sleep?: (ms: number) => Promise<void>;
}

export type SendFinalTotalReadyImmediatelyResult =
  | { ok: true; alreadySent: boolean }
  | { ok: false; reason: "no_email_on_file" | "link_generation_failed" | "send_failed" };

/**
 * The ORIGINAL Finalize & Send notification, sent immediately rather than
 * enqueued for the next dispatch-notifications cron sweep — matches
 * requestFreshPaymentLink's own reasoning (traced real production
 * timestamps showing a purely cron-schedule-driven delay with no actual
 * reason to wait) and reuses the SAME shared retry/idempotency machinery
 * (sendNotificationEmailWithRetry), but is its OWN function, not a call
 * into requestFreshPaymentLink: the two have genuinely different
 * idempotency semantics.
 *
 * - requestFreshPaymentLink's resend attempts are deliberately distinct
 *   physical sends every time (duplicate-cooldown/rate-limit protected,
 *   via claim_payment_link_resend's advisory lock) — a customer or admin
 *   EXPLICITLY asking for another email.
 * - THIS function's idempotency key is `{customerId}:{serviceVisitId}:
 *   final_total_ready:email:{totalAmount}` — identical to what
 *   enqueueNotification has always used for this notification type. A
 *   retried Finalize & Send at the SAME amount must stay a safe no-op
 *   (insertServiceVisitNotification's existing unique-key dedup already
 *   guarantees this atomically, same as before), never a second physical
 *   email. No cooldown/rate-limit logic is needed here at all — this
 *   function is never called repeatedly on purpose the way resend is.
 *
 * ATOMICITY against the cron: after the atomic dedup-insert succeeds, the
 * row is claimed via claimSpecificServiceVisitNotification — a plain
 * single-row `UPDATE ... WHERE state = 'pending'`, which needs no advisory
 * lock (a single row keyed by its own primary key is already fully
 * serialized by Postgres's normal row-level locking against the cron's own
 * FOR UPDATE SKIP LOCKED claim). Once claimed to 'sending', the row is
 * exactly as cron-ineligible as a requestFreshPaymentLink row — not by a
 * shrunk race window, by construction.
 *
 * LINK GENERATION FAILURE: never falls back to a plain (login-required)
 * link — the whole point of this notification is a one-click Final Total
 * link, and sending one that forces a manual sign-in is a materially worse
 * (and, for Pay Per Cleaning specifically, surprising) customer experience
 * than not sending yet. Unlike requestFreshPaymentLink (which treats a
 * generateLink failure as non-transient and fails immediately, since a
 * fresh idempotencyKey there is minted per resend attempt anyway), THIS
 * function retries generateLink itself up to SEND_MAX_ATTEMPTS times with
 * RETRY_BACKOFF_MS between attempts — safe to retry here specifically
 * because no email has been sent yet at this point, so nothing has reached
 * Resend under the fixed idempotencyKey that a differently-tokened retry
 * could conflict with. Only once those attempts are exhausted is the row
 * marked terminal 'failed' (reason "link_generation_failed") — recoverable
 * via the SAME existing generic mechanism every other failure here uses:
 * the admin UI's manual retry (retryFailedServiceVisitNotification) resets
 * it to 'pending', and the cron's own claim/dispatch picks it up on its
 * next sweep and mints a fresh link at that time. No row is ever abandoned
 * un-retryable.
 */
export async function sendFinalTotalReadyImmediately(
  deps: SendFinalTotalReadyImmediatelyDeps,
  params: {
    serviceVisitId: string;
    customerId: string;
    visitStartAtUtc: Date | null;
    timezone: string;
    totalAmount: number;
    /** service_visit_pricing.revisionNumber — 0 for every visit that has never been through start_visit_pricing_revision(). */
    revisionNumber: number;
  }
): Promise<SendFinalTotalReadyImmediatelyResult> {
  const now = deps.now?.() ?? new Date();
  // Backward-compatible: a never-revised visit (revisionNumber 0 — the
  // default for every pre-existing row) keeps the EXACT original,
  // amount-based key format, so deduplication against already-sent
  // notifications is unaffected by this change. Only once a visit has
  // genuinely been through a revision does the key become revision-scoped
  // — exactly where the amount-based key's two failure modes (same amount
  // after a scope-only change; price returning to a previously-sent figure)
  // actually occur, since neither is possible before a revision exists.
  const idempotencyKey =
    params.revisionNumber > 0
      ? `${params.customerId}:${params.serviceVisitId}:final_total_ready:email:revision:${params.revisionNumber}`
      : `${params.customerId}:${params.serviceVisitId}:final_total_ready:email:${params.totalAmount.toFixed(2)}`;

  const insertResult = await deps.repo.insertServiceVisitNotification({
    serviceVisitId: params.serviceVisitId,
    customerId: params.customerId,
    notificationType: "final_total_ready",
    channel: "email",
    scheduledSendAt: now,
    idempotencyKey,
  });

  if (!insertResult.inserted) {
    // Same (visit, amount) already sent — the existing idempotency
    // guarantee every caller of this notification type has always relied
    // on, unchanged.
    return { ok: true, alreadySent: true };
  }

  const inserted = (await deps.repo.listServiceVisitNotifications(params.serviceVisitId)).find((n) => n.idempotencyKey === idempotencyKey);
  if (!inserted) {
    throw new Error(`[scheduling] final_total_ready notification vanished immediately after insert (visit ${params.serviceVisitId})`);
  }

  const claimed = await deps.repo.claimSpecificServiceVisitNotification(inserted.id);
  if (!claimed) {
    // Lost a genuine race to something else claiming this exact row
    // between our insert and our claim — exceedingly rare (nothing claims
    // a scheduled_send_at="now" row except the cron, which only grabs
    // rows already due in the PAST by its own schedule). Treat as already
    // being handled, not a failure worth surfacing.
    return { ok: true, alreadySent: true };
  }

  const contact = await deps.contactLookup(params.customerId);
  if (!contact?.email) {
    await deps.repo.markServiceVisitNotificationFailedTerminal(claimed.id, "no email on file");
    return { ok: false, reason: "no_email_on_file" };
  }

  const sleep = deps.sleep ?? realSleep;
  const path = `/my/payments?visit=${params.serviceVisitId}`;
  let authenticatedLink: string | null = null;
  let lastLinkFailureReason = "unknown error";
  for (let attempt = 1; attempt <= SEND_MAX_ATTEMPTS; attempt++) {
    const link = await deps.authLinkGenerator.generate(contact.email, path);
    if (link.ok) {
      authenticatedLink = link.actionLink;
      break;
    }
    lastLinkFailureReason = link.reason;
    if (attempt < SEND_MAX_ATTEMPTS) await sleep(RETRY_BACKOFF_MS);
  }
  if (!authenticatedLink) {
    await deps.repo.markServiceVisitNotificationFailedTerminal(claimed.id, `link generation failed: ${lastLinkFailureReason}`);
    return { ok: false, reason: "link_generation_failed" };
  }

  const content = buildNotificationContent({
    notificationType: "final_total_ready",
    customerName: contact.name,
    visitStartAtUtc: params.visitStartAtUtc,
    timezone: params.timezone,
    serviceVisitId: params.serviceVisitId,
    authenticatedLink,
  });

  const sendResult = await sendNotificationEmailWithRetry(
    {
      emailSender: deps.emailSender,
      markSent: deps.repo.markServiceVisitNotificationSent,
      markFailedTerminal: deps.repo.markServiceVisitNotificationFailedTerminal,
      sleep: deps.sleep,
    },
    claimed.id,
    { to: contact.email, subject: content.subject, text: content.text, html: content.html, idempotencyKey }
  );

  return sendResult.ok ? { ok: true, alreadySent: false } : sendResult;
}
