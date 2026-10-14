import "server-only";

import { buildNotificationContent } from "@/lib/notifications/notification-content";
import type { NotificationEmailSender } from "@/lib/notifications/email-sender";
import type { NotificationRecipientContact } from "@/lib/notifications/customer-contact-lookup";
import type { ServiceVisitNotificationRow } from "@/lib/scheduling/domain-types";
import type { SchedulingRepository } from "@/lib/scheduling/repository";
import type { CustomerAuthLinkGenerator } from "./customer-auth-link";

export type RequestFreshPaymentLinkResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "visit_not_found"
        | "not_payable"
        | "no_email_on_file"
        | "link_generation_failed"
        | "send_failed"
        | "duplicate_request"
        | "rate_limited";
    };

export interface RequestFreshPaymentLinkDeps {
  repo: SchedulingRepository;
  contactLookup: (customerId: string) => Promise<NotificationRecipientContact | null>;
  authLinkGenerator: CustomerAuthLinkGenerator;
  emailSender: NotificationEmailSender;
  /** Injectable clock — defaults to the real one; tests pin it so cooldown/rate-limit math is deterministic. */
  now?: () => Date;
  /** Injectable backoff delay — defaults to a real setTimeout; tests pass a no-op so retry coverage doesn't add real wall-clock time. */
  sleep?: (ms: number) => Promise<void>;
}

/** Two resend attempts for the SAME visit within this window are almost certainly a double-click or a retried form submit, not two genuine separate requests. */
const DUPLICATE_COOLDOWN_MS = 30_000;
/** Beyond this many resend attempts in the window below, something is wrong (abuse, a stuck retry loop, repeated admin clicking) — block rather than keep sending. */
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const RATE_LIMIT_MAX_ATTEMPTS = 3;
/** One initial attempt plus two retries — a real Resend outage lasting longer than this needs a human, not a tighter retry loop. */
const SEND_MAX_ATTEMPTS = 3;
const RETRY_BACKOFF_MS = 500;

function realSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Shared secure resend logic — the one place that sends a fresh Final Total
 * one-click link, used by BOTH the unauthenticated customer
 * /my/payment-link-expired page (the customer has no session; this IS their
 * recovery path for an expired/already-used link) and the admin "Resend
 * Final Total Link" action.
 *
 * Deliberately NOT routed through the automated dispatch cron
 * (dispatch-due-notifications.ts): sends immediately, synchronously, within
 * this call — not enqueued for the next 5-minute sweep. Traced against real
 * production timestamps: an admin resend that went through the old
 * enqueue-and-wait path took anywhere from under a minute to just under 5
 * minutes to actually leave, purely as a function of how the click happened
 * to land relative to the cron's fixed schedule — never a bug, just
 * unnecessary queueing for an action that has no reason to wait.
 *
 * Still writes a service_visit_notifications row — not for the cron to
 * later claim (scheduledSendAt here is informational, a record of request
 * time, never a future due time), but as the SAME durable, auditable ledger
 * every other notification uses, marked with the REAL outcome
 * (markServiceVisitNotificationSent/FailedTerminal) the moment it's known —
 * critically, this row is NEVER left 'pending' once this function returns.
 * The row is inserted 'pending' and resolved synchronously without ever
 * going through claimDueServiceVisitNotifications (it stays 'pending' the
 * whole time, by design — this is a direct send, not a cron-claimed one), so
 * markServiceVisitNotificationSent/FailedTerminal were widened (see their
 * own doc comments in supabase-scheduling-repository.ts /
 * fake-scheduling-repository.ts) to accept a prior state of 'pending', not
 * only the cron flow's 'sending'. Leaving that widening out would silently
 * no-op the mark-resolved call (both the real UPDATE's WHERE clause and the
 * fake's equivalent guard only matched 'sending'), stranding the row at
 * 'pending' — which the real cron, on its next sweep, would then
 * legitimately claim and send for real, producing an actual duplicate email
 * despite everything above. This reuses the existing table/repo methods —
 * no new table, no migration — just a corrected guard condition.
 *
 * Duplicate protection: a second request within DUPLICATE_COOLDOWN_MS of the
 * most recent final_total_ready notification (by its own scheduledSendAt,
 * which this function always sets to "now" for its own attempts) is
 * rejected outright — almost certainly a double-click, not a second genuine
 * request. The notification ledger's own idempotency_key unique constraint
 * is the hard backstop underneath this soft check, for a true concurrent
 * race.
 *
 * Rate limiting: more than RATE_LIMIT_MAX_ATTEMPTS resend attempts (not
 * counting the original automated send) within RATE_LIMIT_WINDOW_MS blocks
 * further attempts — a visit genuinely shouldn't need its Final Total
 * re-sent more than a couple of times an hour; beyond that is abuse-shaped
 * regardless of who's clicking.
 *
 * Retry handling: the actual provider send is attempted up to
 * SEND_MAX_ATTEMPTS times with a short fixed backoff before giving up —
 * link generation itself is NOT retried (a generateLink failure is treated
 * as non-transient here; retrying it changes which token is at stake and
 * complicates the ledger row, not worth it for the rare cases it fails).
 *
 * Unlike the automated dispatcher, this never falls back to a plain
 * (login-required) link on generation failure — the entire point of this
 * action is handing back a one-click link; a plain link would only return
 * the customer to the same expired-link page (or, for the admin caller,
 * send something materially different from what was asked for).
 *
 * Callers are responsible for never surfacing WHICH failure reason occurred
 * to an unauthenticated caller — only "sent" or "something went wrong" — so
 * this cannot be used to probe which visit ids exist, are payable, or have
 * an email on file. The admin caller, already authenticated and authorized,
 * may show the real reason.
 */
export async function requestFreshPaymentLink(deps: RequestFreshPaymentLinkDeps, serviceVisitId: string): Promise<RequestFreshPaymentLinkResult> {
  const now = deps.now?.() ?? new Date();
  const sleep = deps.sleep ?? realSleep;

  const visit = await deps.repo.findServiceVisitById(serviceVisitId);
  if (!visit) return { ok: false, reason: "visit_not_found" };

  const pricing = await deps.repo.findServiceVisitPricingByVisitId(serviceVisitId);
  const alreadyPaid = pricing?.paymentStatus === "paid";
  if (visit.status !== "completed" || !pricing || pricing.priceStatus !== "confirmed" || alreadyPaid) {
    return { ok: false, reason: "not_payable" };
  }

  // Scoped to THIS function's own prior attempts only (idempotency keys this
  // function itself mints, below) — never the original automated
  // Finalize & Send, which is a different, unrelated call with its own
  // idempotency key shape. Duplicate/rate-limit protection exists to catch
  // a resend being requested repeatedly, not to restrict how soon after the
  // original send a first resend may happen.
  const priorResendAttempts = (await deps.repo.listServiceVisitNotifications(serviceVisitId)).filter(
    (n): n is ServiceVisitNotificationRow => n.notificationType === "final_total_ready" && n.idempotencyKey.includes(":resend:")
  );

  const mostRecentAt = priorResendAttempts.reduce<number | null>(
    (latest, n) => (latest === null || n.scheduledSendAt.getTime() > latest ? n.scheduledSendAt.getTime() : latest),
    null
  );
  if (mostRecentAt !== null && now.getTime() - mostRecentAt < DUPLICATE_COOLDOWN_MS) {
    return { ok: false, reason: "duplicate_request" };
  }

  const recentAttemptCount = priorResendAttempts.filter((n) => now.getTime() - n.scheduledSendAt.getTime() < RATE_LIMIT_WINDOW_MS).length;
  if (recentAttemptCount >= RATE_LIMIT_MAX_ATTEMPTS) {
    return { ok: false, reason: "rate_limited" };
  }

  const contact = await deps.contactLookup(visit.customerId);
  if (!contact?.email) return { ok: false, reason: "no_email_on_file" };

  const link = await deps.authLinkGenerator.generate(contact.email, `/my/payments?visit=${serviceVisitId}`);
  if (!link.ok) return { ok: false, reason: "link_generation_failed" };

  const content = buildNotificationContent({
    notificationType: "final_total_ready",
    customerName: contact.name,
    visitStartAtUtc: visit.confirmedStartAt ?? null,
    timezone: visit.timezone,
    serviceVisitId,
    authenticatedLink: link.actionLink,
  });

  const idempotencyKey = `${visit.customerId}:${serviceVisitId}:final_total_ready:email:resend:${now.getTime()}`;
  const insertResult = await deps.repo.insertServiceVisitNotification({
    serviceVisitId,
    customerId: visit.customerId,
    notificationType: "final_total_ready",
    channel: "email",
    scheduledSendAt: now,
    idempotencyKey,
  });
  if (!insertResult.inserted) {
    // Lost a genuine concurrent race against an identical in-flight request.
    return { ok: false, reason: "duplicate_request" };
  }
  const ledgerRow = (await deps.repo.listServiceVisitNotifications(serviceVisitId)).find((n) => n.idempotencyKey === idempotencyKey) ?? null;

  let lastFailureReason = "unknown error";
  for (let attempt = 1; attempt <= SEND_MAX_ATTEMPTS; attempt++) {
    const outcome = await deps.emailSender.send({
      to: contact.email,
      subject: content.subject,
      text: content.text,
      html: content.html,
      idempotencyKey,
    });
    if (outcome.sent) {
      if (ledgerRow) await deps.repo.markServiceVisitNotificationSent(ledgerRow.id, outcome.providerMessageId ?? null);
      return { ok: true };
    }
    lastFailureReason = outcome.failureReason ?? "unknown error";
    if (attempt < SEND_MAX_ATTEMPTS) await sleep(RETRY_BACKOFF_MS);
  }

  if (ledgerRow) await deps.repo.markServiceVisitNotificationFailedTerminal(ledgerRow.id, lastFailureReason);
  return { ok: false, reason: "send_failed" };
}
