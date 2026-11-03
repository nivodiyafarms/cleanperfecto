"use server";

import { getTrustedClientIp } from "@/lib/http/trusted-client-ip";
import type { ReferralCodeCheckResult } from "./check-referral-code-status";
import { lookupReferralCodeActive } from "./lookup-referral-code-active";
import { takeReferralCodeCheckRateLimit } from "./referral-code-check-rate-limit";
import { runCheckReferralCode } from "./run-check-referral-code";

/**
 * Public quote-wizard referral probe. Returns status only. Rate-limit and
 * lookup failures both surface as `error` (try again) — never as inactive.
 * Shared limiter denials surface as `rate_limited` with retry_after_seconds.
 *
 * Does not attribute referrals or issue credit — quote stage stays read-only
 * for the program; booking-time attribution stays on its existing path.
 */
export async function checkReferralCodeAction(rawCode: string): Promise<ReferralCodeCheckResult> {
  return runCheckReferralCode(rawCode, {
    getClientIp: getTrustedClientIp,
    takeRateLimit: takeReferralCodeCheckRateLimit,
    lookupByNormalizedCode: lookupReferralCodeActive,
  });
}
