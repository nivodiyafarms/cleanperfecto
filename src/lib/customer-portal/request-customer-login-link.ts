import "server-only";

import type { CustomerAuthLinkGenerator } from "./customer-auth-link";
import type { NotificationEmailSender, NotificationEmailSendInput } from "@/lib/notifications/email-sender";
import { normalizeEmail } from "@/lib/instant-quote/normalize-email";
import type { ClaimCustomerLoginLinkRequestResult } from "./claim-customer-login-link-request";

/** One request every 2 minutes, at most 5 per 10-minute window — generous enough for a customer who didn't get the first email, strict enough to block abuse of the (otherwise rate-limit-free) admin generateLink API. */
export const RATE_LIMIT_WINDOW_SECONDS = 600;
export const RATE_LIMIT_MAX_ATTEMPTS = 5;
/** Mirrors SEND_MAX_ATTEMPTS/RETRY_BACKOFF_MS used for every other immediate (non-cron) send in this codebase — see send-notification-with-retry.ts. Inlined here rather than imported since that module doesn't exist on this branch. */
const SEND_MAX_ATTEMPTS = 3;
const RETRY_BACKOFF_MS = 500;

export type RequestCustomerLoginLinkResult = { ok: true } | { ok: false; reason: "rate_limited" | "error" };

export interface RequestCustomerLoginLinkDeps {
  claimLoginLinkRequest(emailNormalized: string, now: Date): Promise<ClaimCustomerLoginLinkRequestResult>;
  authLinkGenerator: CustomerAuthLinkGenerator;
  emailSender: NotificationEmailSender;
  /** Injectable clock — defaults to the real one; tests pin it for determinism. */
  now?: () => Date;
  /** Injectable backoff delay — defaults to a real setTimeout; tests pass a no-op. */
  sleep?: (ms: number) => Promise<void>;
}

function realSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildLoginLinkEmail(actionLink: string): Omit<NotificationEmailSendInput, "to" | "idempotencyKey"> {
  return {
    subject: "Your CleanPerfecto sign-in link",
    text: `Click the link below to sign in to your CleanPerfecto account:\n\n${actionLink}\n\nThis link expires shortly and can only be used once. If you didn't request this, you can safely ignore this email.`,
    html: `<p>Click the button below to sign in to your CleanPerfecto account.</p><p><a href="${actionLink}">Sign in to CleanPerfecto</a></p><p>This link expires shortly and can only be used once. If you didn't request this, you can safely ignore this email.</p>`,
  };
}

/**
 * Backs /my/login's "Email me a sign-in link" form. Replaces the previous
 * client-side supabase.auth.signInWithOtp call, which depended on
 * Supabase's own Auth "Redirect URLs" allowlist — confirmed (against a real
 * Preview deployment) to be the actual root cause of magic links silently
 * landing on the public homepage instead of the customer portal: GoTrue
 * rejects an unrecognized emailRedirectTo and substitutes its configured
 * Site URL WHOLESALE (origin AND path), before the email is even sent, no
 * matter how that redirect URL is constructed. createSupabaseCustomerAuthLinkGenerator
 * (used here) has no such dependency — see its own doc comment — so this
 * is reliable across every deployment, including ephemeral Preview URLs an
 * allowlist could never practically enumerate.
 *
 * The destination (`next`) is embedded directly in the generated link's
 * own `next` query parameter (see createSupabaseCustomerAuthLinkGenerator),
 * not a cookie or any other client-side state — it is preserved correctly
 * even when the email is opened in a completely different browser/device
 * than the one that submitted this form.
 *
 * SECURITY — never reveals whether `email` matches a real customer:
 *   - The rate-limit claim runs identically for any syntactically
 *     plausible email, matched or not.
 *   - generateLink() is called unconditionally — Supabase's own documented
 *     behavior already auto-provisions an Auth user for an email with no
 *     prior history (same as the old signInWithOtp behavior it replaces),
 *     so there is no separate "does this customer exist" branch to leak
 *     through timing or response shape. A non-matching email's link still
 *     sends; clicking it simply lands on /my/activate's "couldn't find an
 *     account" state — never a dead end, never an information leak.
 *   - Every failure path (rate limited vs. any other problem) maps to one
 *     of exactly two caller-visible reasons; neither ever varies based on
 *     customer-match status.
 */
export async function requestCustomerLoginLink(
  deps: RequestCustomerLoginLinkDeps,
  rawEmail: string,
  next: string
): Promise<RequestCustomerLoginLinkResult> {
  const email = normalizeEmail(rawEmail);
  if (!email || !email.includes("@")) {
    return { ok: false, reason: "error" };
  }

  const now = deps.now?.() ?? new Date();
  const claim = await deps.claimLoginLinkRequest(email, now);
  if (!claim.ok) return { ok: false, reason: claim.reason };

  const outcome = await deps.authLinkGenerator.generate(email, next);
  if (!outcome.ok) {
    // Never surfaced to the customer beyond the generic "error" reason —
    // the real cause (logged server-side by the generator's own caller,
    // if anywhere) could otherwise become a second information channel.
    return { ok: false, reason: "error" };
  }

  const sleep = deps.sleep ?? realSleep;
  const idempotencyKey = `login-link:${email}:${now.getTime()}`;
  const input: NotificationEmailSendInput = { to: email, idempotencyKey, ...buildLoginLinkEmail(outcome.actionLink) };

  let sent = false;
  for (let attempt = 1; attempt <= SEND_MAX_ATTEMPTS; attempt++) {
    const result = await deps.emailSender.send(input);
    if (result.sent) {
      sent = true;
      break;
    }
    if (attempt < SEND_MAX_ATTEMPTS) await sleep(RETRY_BACKOFF_MS);
  }

  return sent ? { ok: true } : { ok: false, reason: "error" };
}
