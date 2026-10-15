import "server-only";

import type { NotificationEmailSendInput, NotificationEmailSender } from "./email-sender";

/** One initial attempt plus two retries — a real provider outage lasting longer than this needs a human, not a tighter retry loop. Shared by every immediate (non-cron) send path — requestFreshPaymentLink and the original Finalize & Send. */
export const SEND_MAX_ATTEMPTS = 3;
export const RETRY_BACKOFF_MS = 500;

export interface SendWithRetryDeps {
  emailSender: NotificationEmailSender;
  markSent(id: string, providerMessageId: string | null): Promise<void>;
  markFailedTerminal(id: string, failureReason: string): Promise<void>;
  /** Injectable — defaults to a real setTimeout; tests pass a no-op so retry coverage doesn't add real wall-clock time. */
  sleep?: (ms: number) => Promise<void>;
}

function realSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Sends one email with up to SEND_MAX_ATTEMPTS attempts, resolving the
 * already-claimed ledger row (sent or failed) on every path — extracted so
 * requestFreshPaymentLink and the original Finalize & Send immediate-send
 * path share IDENTICAL retry/idempotency/ledger-resolution behavior rather
 * than two copies drifting apart.
 *
 * PROVIDER IDEMPOTENCY: `input` (including `idempotencyKey`) is fixed by
 * the caller BEFORE calling this function and reused unchanged on every
 * attempt here — this is what makes "the provider actually sent it but the
 * response timed out" safe. Resend's own API treats a repeated
 * Idempotency-Key as a replay of the original request and returns that
 * original result rather than sending a second physical email, so a retry
 * after a timeout either genuinely failed (safely retried) or genuinely
 * succeeded (the "retry" just receives Resend's own record of that, which
 * this function treats as outcome.sent === true exactly like a first-try
 * success — nothing here distinguishes the two cases, deliberately).
 *
 * AFTER THE ATTEMPTS ARE EXHAUSTED: markFailedTerminal leaves the row
 * 'failed' — terminal, no further automatic attempt from this path. The
 * durable recovery is the EXISTING generic mechanism every notification
 * type already has: the admin UI's manual retry
 * (retryFailedServiceVisitNotification) resets it to 'pending', and the
 * cron's own claim/dispatch then picks it up on its next sweep (and
 * correctly regenerates a fresh link at that time, since the one from this
 * attempt may be stale by then). No special-casing is needed for a row
 * from either calling path to work with that mechanism.
 */
export async function sendNotificationEmailWithRetry(
  deps: SendWithRetryDeps,
  ledgerRowId: string,
  input: NotificationEmailSendInput
): Promise<{ ok: true } | { ok: false; reason: "send_failed" }> {
  const sleep = deps.sleep ?? realSleep;
  let lastFailureReason = "unknown error";

  for (let attempt = 1; attempt <= SEND_MAX_ATTEMPTS; attempt++) {
    const outcome = await deps.emailSender.send(input);
    if (outcome.sent) {
      await deps.markSent(ledgerRowId, outcome.providerMessageId ?? null);
      return { ok: true };
    }
    lastFailureReason = outcome.failureReason ?? "unknown error";
    if (attempt < SEND_MAX_ATTEMPTS) await sleep(RETRY_BACKOFF_MS);
  }

  await deps.markFailedTerminal(ledgerRowId, lastFailureReason);
  return { ok: false, reason: "send_failed" };
}
