/**
 * Decides where /my/auth/confirm redirects to, independent of the actual
 * Next.js request/response and Supabase client glue — same "extract the
 * pure decision" pattern as resolveCustomerAuthCallbackRedirectPath
 * (the /my/auth/callback `code`-exchange route's own analogous helper).
 * `next` must already be sanitized (see sanitizeNextPath) by the caller
 * before being passed in here — this function only decides the outcome
 * shape, it never re-validates the redirect target itself.
 *
 * `next` is carried through on EVERY outcome, not just "success".
 *
 * A failure whose intended destination was a specific visit's payment
 * review (/my/payments?visit=<id>) is NOT sent to the generic /my/login —
 * that would be a dead end: a customer with no password and no existing
 * session has no way to "just sign in again" there, and bouncing them to a
 * sign-in page is not a successful outcome for a payment-link click, it's
 * the same failure with extra steps. Instead it redirects to
 * /my/payment-link-expired?visit=<id>, a branded, unauthenticated page that
 * preserves the visit and offers to send a fresh link. Any OTHER
 * destination (e.g. /my/cleanings from a plain reminder link) still falls
 * back to /my/login?next=..., exactly like proxy.ts already does for an
 * expired session — that generic page remains the right answer when there
 * isn't a more specific one.
 */
export type CustomerAuthConfirmOutcome =
  | { status: "missing_token"; next: string }
  | { status: "verify_failed"; next: string }
  | { status: "success"; next: string };

const PAYMENT_VISIT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const AGREED_QUOTE_INVITATION_PATTERN = /^\/my\/agreed-quote\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/** Extracts the visit id ONLY when `next` is exactly a /my/payments?visit=<uuid> destination — never a partial/fuzzy match on some other path that merely contains "payments". */
function extractPaymentVisitId(next: string): string | null {
  let url: URL;
  try {
    url = new URL(next, "http://placeholder.invalid");
  } catch {
    return null;
  }
  if (url.pathname !== "/my/payments") return null;
  const visitId = url.searchParams.get("visit");
  return visitId && PAYMENT_VISIT_ID_PATTERN.test(visitId) ? visitId : null;
}

/** Extracts the invitation id ONLY when `next` is exactly a /my/agreed-quote/<uuid> destination — same exact-match discipline as extractPaymentVisitId. */
function extractAgreedQuoteInvitationId(next: string): string | null {
  let url: URL;
  try {
    url = new URL(next, "http://placeholder.invalid");
  } catch {
    return null;
  }
  const match = url.pathname.match(AGREED_QUOTE_INVITATION_PATTERN);
  return match ? match[1] : null;
}

export function resolveCustomerAuthConfirmRedirectPath(outcome: CustomerAuthConfirmOutcome): string {
  if (outcome.status === "success") {
    return `/my/activate?next=${encodeURIComponent(outcome.next)}`;
  }
  const paymentVisitId = extractPaymentVisitId(outcome.next);
  if (paymentVisitId) {
    return `/my/payment-link-expired?visit=${encodeURIComponent(paymentVisitId)}`;
  }
  const agreedQuoteInvitationId = extractAgreedQuoteInvitationId(outcome.next);
  if (agreedQuoteInvitationId) {
    return `/my/agreed-quote-link-expired?invitation=${encodeURIComponent(agreedQuoteInvitationId)}`;
  }
  return `/my/login?next=${encodeURIComponent(outcome.next)}`;
}
