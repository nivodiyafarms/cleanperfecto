/**
 * Decides where /my/auth/confirm redirects to, independent of the actual
 * Next.js request/response and Supabase client glue — same "extract the
 * pure decision" pattern as resolveCustomerAuthCallbackRedirectPath
 * (the /my/auth/callback `code`-exchange route's own analogous helper).
 * `next` must already be sanitized (see sanitizeNextPath) by the caller
 * before being passed in here — this function only decides the outcome
 * shape, it never re-validates the redirect target itself.
 *
 * `next` is carried through on EVERY outcome, not just "success" — a
 * customer whose one-click link fails to verify (expired, already used, or
 * any other rejection) or arrives malformed (missing/unsupported
 * token_hash/type) still gets routed to /my/login with their intended
 * destination preserved as ?next=, exactly like proxy.ts already does for
 * an expired session. Without this, a failed verification silently dropped
 * the customer onto a context-free sign-in page with no way back to, e.g.,
 * their Final Total review short of re-finding the original email.
 */
export type CustomerAuthConfirmOutcome =
  | { status: "missing_token"; next: string }
  | { status: "verify_failed"; next: string }
  | { status: "success"; next: string };

export function resolveCustomerAuthConfirmRedirectPath(outcome: CustomerAuthConfirmOutcome): string {
  if (outcome.status === "success") {
    return `/my/activate?next=${encodeURIComponent(outcome.next)}`;
  }
  return `/my/login?next=${encodeURIComponent(outcome.next)}`;
}
