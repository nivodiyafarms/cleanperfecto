import "server-only";

import { buildNotificationContent } from "@/lib/notifications/notification-content";
import { sendNotificationEmailWithRetry } from "@/lib/notifications/send-notification-with-retry";
import type { NotificationEmailSender } from "@/lib/notifications/email-sender";
import type { NotificationRecipientContact } from "@/lib/notifications/customer-contact-lookup";
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
const DUPLICATE_COOLDOWN_SECONDS = 30;
/** Beyond this many resend attempts in the window below, something is wrong (abuse, a stuck retry loop, repeated admin clicking) — block rather than keep sending. */
const RATE_LIMIT_WINDOW_SECONDS = 60 * 60;
const RATE_LIMIT_MAX_ATTEMPTS = 3;

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
 * production timestamps before this existed: an admin resend that went
 * through the old enqueue-and-wait path took anywhere from under a minute to
 * just under 5 minutes to actually leave, purely as a function of how the
 * click happened to land relative to the cron's fixed schedule — never a
 * bug, just unnecessary queueing for an action that has no reason to wait.
 *
 * ATOMICITY — this is the part that matters under real concurrency (two
 * admins, an admin and the customer, or a cron tick, all acting near-
 * simultaneously):
 *
 *   claimPaymentLinkResend() (see claim_payment_link_resend() in its
 *   migration) does the duplicate-cooldown check, the rate-limit count, AND
 *   the ledger insert in ONE advisory-locked database transaction, scoped
 *   per visit id. This replaces an earlier version of this function that
 *   read prior attempts and then inserted as two separate round-trips — a
 *   classic TOCTOU race where two concurrent callers could both read "no
 *   recent attempts" before either had written anything, silently bypassing
 *   both protections exactly when concurrency made them matter. A
 *   concurrency test (Promise.all of two simultaneous calls against the same
 *   visit) is what actually proves this, not just the sequential-repeat
 *   tests below.
 *
 *   The claimed row is inserted ALREADY in 'sending' state — never
 *   'pending' at all. claimDueServiceVisitNotifications (the cron's own
 *   atomic claim) only ever looks at 'pending' rows and STALE 'sending' rows
 *   (older than its staleMinutes). A row from this function is therefore
 *   categorically ineligible for the cron to also pick up, by construction,
 *   not by a race window that's merely small. (An earlier version of this
 *   function inserted as 'pending' and tried to resolve it directly,
 *   discovering too late that markServiceVisitNotificationSent/
 *   FailedTerminal's own guard only matches 'sending' — that version would
 *   have silently failed to resolve the row, leaving it 'pending' for the
 *   real cron to pick up and genuinely send again.)
 *
 * PROVIDER IDEMPOTENCY and RETRY: delegated to sendNotificationEmailWithRetry
 * (src/lib/notifications/send-notification-with-retry.ts) — the SAME shared
 * helper the original Finalize & Send's immediate-send path uses, so both
 * get identical retry/idempotency/ledger-resolution behavior. See that
 * module's own doc comment for the full "accepted but response timed out"
 * reasoning and what happens after the attempts are exhausted
 * (terminal 'failed', recovered via the existing generic admin-retry ->
 * cron-claim path, no special-casing needed). Link generation itself is
 * NOT retried here — a generateLink failure is treated as non-transient,
 * and retrying it would mint a DIFFERENT token under the SAME
 * idempotencyKey, breaking the stable-payload guarantee that helper relies
 * on.
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

  const visit = await deps.repo.findServiceVisitById(serviceVisitId);
  if (!visit) return { ok: false, reason: "visit_not_found" };

  const pricing = await deps.repo.findServiceVisitPricingByVisitId(serviceVisitId);
  const alreadyPaid = pricing?.paymentStatus === "paid";
  if (visit.status !== "completed" || !pricing || pricing.priceStatus !== "confirmed" || alreadyPaid) {
    return { ok: false, reason: "not_payable" };
  }

  const idempotencyKey = `${visit.customerId}:${serviceVisitId}:final_total_ready:email:resend:${now.getTime()}`;
  const claim = await deps.repo.claimPaymentLinkResend({
    serviceVisitId,
    customerId: visit.customerId,
    idempotencyKey,
    now,
    cooldownSeconds: DUPLICATE_COOLDOWN_SECONDS,
    rateLimitWindowSeconds: RATE_LIMIT_WINDOW_SECONDS,
    rateLimitMax: RATE_LIMIT_MAX_ATTEMPTS,
  });
  if (!claim.ok) return { ok: false, reason: claim.reason };
  const ledgerRow = claim.row;

  // From here on, the row is claimed ('sending') and MUST be resolved
  // (sent or failed) on every path before returning — an early return that
  // skipped this would leave a 'sending' row no code path ever revisits
  // until the cron's staleness fallback, minutes later, for no real reason.
  const contact = await deps.contactLookup(visit.customerId);
  if (!contact?.email) {
    await deps.repo.markServiceVisitNotificationFailedTerminal(ledgerRow.id, "no email on file");
    return { ok: false, reason: "no_email_on_file" };
  }

  const link = await deps.authLinkGenerator.generate(contact.email, `/my/payments?visit=${serviceVisitId}`);
  if (!link.ok) {
    await deps.repo.markServiceVisitNotificationFailedTerminal(ledgerRow.id, `link generation failed: ${link.reason}`);
    return { ok: false, reason: "link_generation_failed" };
  }

  // Built ONCE, from the already-minted link — reused unchanged on every
  // retry attempt (see sendNotificationEmailWithRetry's own doc comment on
  // provider idempotency).
  const content = buildNotificationContent({
    notificationType: "final_total_ready",
    customerName: contact.name,
    visitStartAtUtc: visit.confirmedStartAt ?? null,
    timezone: visit.timezone,
    serviceVisitId,
    authenticatedLink: link.actionLink,
  });

  return sendNotificationEmailWithRetry(
    {
      emailSender: deps.emailSender,
      markSent: deps.repo.markServiceVisitNotificationSent,
      markFailedTerminal: deps.repo.markServiceVisitNotificationFailedTerminal,
      sleep: deps.sleep,
    },
    ledgerRow.id,
    { to: contact.email, subject: content.subject, text: content.text, html: content.html, idempotencyKey }
  );
}
