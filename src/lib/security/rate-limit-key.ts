import { createHmac } from "node:crypto";
import { normalizeClientIp } from "./normalize-client-ip";

export const REFERRAL_CHECK_RATE_LIMIT_KEY_PREFIX = "referral_check:";

/**
 * Build the opaque rate-limit bucket key for a referral-code check.
 * HMAC-SHA256 of the normalized IP — never store or send the raw IP.
 */
export function buildReferralCheckRateLimitKey(ip: string, secret: string): string {
  const normalized = normalizeClientIp(ip);
  const digest = createHmac("sha256", secret).update(normalized, "utf8").digest("hex");
  return `${REFERRAL_CHECK_RATE_LIMIT_KEY_PREFIX}${digest}`;
}
