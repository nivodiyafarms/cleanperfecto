import "server-only";

/** Minimum length for RATE_LIMIT_HMAC_SECRET — short values fail closed. */
export const RATE_LIMIT_HMAC_SECRET_MIN_LENGTH = 32;

/**
 * Reads and validates RATE_LIMIT_HMAC_SECRET. Returns null when missing or
 * too short so callers can fail closed without throwing across the action boundary.
 */
export function readRateLimitHmacSecret(
  raw: string | undefined = process.env.RATE_LIMIT_HMAC_SECRET
): string | null {
  if (typeof raw !== "string") return null;
  const secret = raw.trim();
  if (secret.length < RATE_LIMIT_HMAC_SECRET_MIN_LENGTH) return null;
  return secret;
}
