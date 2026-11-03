import "server-only";

import { readRateLimitHmacSecret } from "@/lib/security/rate-limit-hmac-secret";
import { buildReferralCheckRateLimitKey } from "@/lib/security/rate-limit-key";
import {
  consumeRateLimitsViaSupabase,
  type ConsumeRateLimitsFn,
  type ConsumeRateLimitResult,
} from "@/lib/security/shared-rate-limit";

/** Per-minute fixed-window budget for the public referral-code probe. */
export const REFERRAL_CODE_CHECK_MINUTE_LIMIT = 5;

/** Per-hour fixed-window budget for the public referral-code probe. */
export const REFERRAL_CODE_CHECK_HOUR_LIMIT = 20;

export type ReferralCodeCheckRateLimitDecision =
  | { outcome: "allowed" }
  | { outcome: "rate_limited"; retry_after_seconds: number }
  | { outcome: "error" };

export type TakeReferralCodeCheckRateLimit = (
  ip: string
) => Promise<ReferralCodeCheckRateLimitDecision>;

/**
 * Fail-closed shared rate limit for the quote-page referral check.
 * Requires a usable client IP and RATE_LIMIT_HMAC_SECRET; never looks up the
 * code when the limiter cannot confirm an allowance.
 */
export function createTakeReferralCodeCheckRateLimit(options?: {
  consume?: ConsumeRateLimitsFn;
  readSecret?: () => string | null;
}): TakeReferralCodeCheckRateLimit {
  const consume = options?.consume ?? consumeRateLimitsViaSupabase;
  const readSecret = options?.readSecret ?? readRateLimitHmacSecret;

  return async (ip: string): Promise<ReferralCodeCheckRateLimitDecision> => {
    const secret = readSecret();
    if (!secret) {
      return { outcome: "error" };
    }

    const trimmedIp = ip.trim();
    if (!trimmedIp) {
      return { outcome: "error" };
    }

    const key = buildReferralCheckRateLimitKey(trimmedIp, secret);
    const result: ConsumeRateLimitResult = await consume({
      key,
      minuteLimit: REFERRAL_CODE_CHECK_MINUTE_LIMIT,
      hourLimit: REFERRAL_CODE_CHECK_HOUR_LIMIT,
    });

    if (!result.ok) {
      return { outcome: "error" };
    }

    if (!result.allowed) {
      return {
        outcome: "rate_limited",
        retry_after_seconds: result.retry_after_seconds,
      };
    }

    return { outcome: "allowed" };
  };
}

export const takeReferralCodeCheckRateLimit = createTakeReferralCodeCheckRateLimit();
