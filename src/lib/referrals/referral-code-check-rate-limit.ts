import { createInMemoryRateLimiter } from "@/lib/security/in-memory-rate-limiter";

/** Generous enough for blur + load + submit revalidation; tight enough to blunt probing. */
export const REFERRAL_CODE_CHECK_RATE_LIMIT_WINDOW_MS = 60_000;
export const REFERRAL_CODE_CHECK_RATE_LIMIT_MAX = 20;

export const referralCodeCheckRateLimiter = createInMemoryRateLimiter({
  windowMs: REFERRAL_CODE_CHECK_RATE_LIMIT_WINDOW_MS,
  maxAttempts: REFERRAL_CODE_CHECK_RATE_LIMIT_MAX,
});
