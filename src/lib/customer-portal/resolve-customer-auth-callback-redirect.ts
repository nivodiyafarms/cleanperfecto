/**
 * Decides where /my/auth/callback redirects to, independent of the actual
 * Next.js request/response and Supabase client glue — same "extract the
 * pure decision" pattern as resolveRecoveryCallbackRedirectPath
 * (src/lib/admin/auth/resolve-recovery-callback-redirect.ts). `next` must
 * already be sanitized (see sanitizeNextPath) by the caller before being
 * passed in here — this function only decides the outcome shape, it never
 * re-validates the redirect target itself.
 */
export type CustomerAuthCallbackOutcome =
  | { status: "missing_code" }
  | { status: "exchange_failed" }
  | { status: "success"; next: string };

export function resolveCustomerAuthCallbackRedirectPath(outcome: CustomerAuthCallbackOutcome): string {
  if (outcome.status === "success") {
    return `/my/activate?next=${encodeURIComponent(outcome.next)}`;
  }
  return "/my/login";
}
