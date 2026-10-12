/**
 * Reduces a Supabase verifyOtp() failure down to a short, stable, SAFE-TO-LOG
 * code — never the free-text `.message` (which this codebase does not treat
 * as reviewed/bounded the way RuntimeConfigurationError's messages are, see
 * stripe-diagnostics.ts), never the token_hash, never the request URL.
 *
 * `error.code` is Supabase Auth's own enum-like identifier (e.g.
 * "otp_expired") — already a closed, documented vocabulary (see
 * @supabase/auth-js's ErrorCode type) — but this still re-validates its
 * shape defensively before logging it, rather than trusting an SDK/server
 * version to always stay within that vocabulary. An absent or malformed
 * code logs as "unknown_error_code" rather than being dropped silently, so
 * "verification failed but we don't know why" stays visible as its own
 * distinct, searchable signal.
 *
 * Deliberately does NOT attempt to label this a clock-skew issue or any
 * other specific cause — that stays a hypothesis for a human to evaluate
 * against the actual code/status captured here over time, never asserted
 * by this function.
 */
export interface SanitizableAuthConfirmError {
  code?: string | null;
  status?: number | null;
}

const SAFE_CODE_PATTERN = /^[a-z0-9_]{1,64}$/;

export function sanitizeAuthConfirmErrorCode(error: SanitizableAuthConfirmError | null | undefined): string {
  const code = error?.code;
  if (typeof code === "string" && SAFE_CODE_PATTERN.test(code)) {
    return code;
  }
  return "unknown_error_code";
}

export function sanitizeAuthConfirmErrorStatus(error: SanitizableAuthConfirmError | null | undefined): number | "unknown" {
  const status = error?.status;
  return typeof status === "number" && Number.isFinite(status) ? status : "unknown";
}
