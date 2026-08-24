/**
 * Validates a candidate post-login destination against an allowlist of
 * internal /my/... paths only — never trusted as an open redirect target.
 * Shared by /my/auth/callback (the real login redirect) and notification
 * link-building (src/lib/notifications/portal-link.ts), so both apply the
 * exact same allowlist rather than two copies drifting apart.
 */
export function sanitizeNextPath(raw: string | null | undefined): string {
  if (!raw) return "/my";
  if (raw !== "/my" && !raw.startsWith("/my/")) return "/my";
  return raw;
}
