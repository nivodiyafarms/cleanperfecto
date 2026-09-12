/**
 * Decides where /admin/auth/callback redirects to, independent of the
 * actual Next.js request/response and Supabase client glue (same "extract
 * the pure decision" pattern as resolveAdminSession in require-admin.ts).
 * There is no client-suppliable redirect target anywhere in this callback —
 * both possible outcomes are fixed internal admin paths, so there is no
 * open-redirect surface to validate against in the first place.
 */
export type RecoveryCallbackOutcome = { status: "missing_code" } | { status: "exchange_failed" } | { status: "success" };

export function resolveRecoveryCallbackRedirectPath(outcome: RecoveryCallbackOutcome): "/admin/reset-password" | "/admin/login" {
  return outcome.status === "success" ? "/admin/reset-password" : "/admin/login";
}
