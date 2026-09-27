/**
 * Decides where /my/auth/confirm redirects to, independent of the actual
 * Next.js request/response and Supabase client glue — same "extract the
 * pure decision" pattern as resolveCustomerAuthCallbackRedirectPath
 * (the /my/auth/callback `code`-exchange route's own analogous helper).
 * `next` must already be sanitized (see sanitizeNextPath) by the caller
 * before being passed in here — this function only decides the outcome
 * shape, it never re-validates the redirect target itself.
 */
export type CustomerAuthConfirmOutcome =
  | { status: "missing_token" }
  | { status: "verify_failed" }
  | { status: "success"; next: string };

export function resolveCustomerAuthConfirmRedirectPath(outcome: CustomerAuthConfirmOutcome): string {
  if (outcome.status === "success") {
    return `/my/activate?next=${encodeURIComponent(outcome.next)}`;
  }
  return "/my/login";
}
