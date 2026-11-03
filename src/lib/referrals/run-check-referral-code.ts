import {
  checkReferralCodeStatus,
  type ReferralCodeCheckResult,
  type ReferralCodeLookupOutcome,
} from "./check-referral-code-status";
import type { ReferralCodeCheckRateLimitDecision } from "./referral-code-check-rate-limit";

export type RunCheckReferralCodeDeps = {
  getClientIp: () => Promise<string | null>;
  takeRateLimit: (ip: string) => Promise<ReferralCodeCheckRateLimitDecision>;
  lookupByNormalizedCode: (code: string) => Promise<ReferralCodeLookupOutcome>;
};

/**
 * Shared implementation for the public check action. Kept free of the
 * `"use server"` boundary so unit tests can inject fakes without going
 * through the Next.js action serializer.
 *
 * Fail closed: missing IP, limiter errors, and RPC failures all return
 * `error` and never run the code lookup. Rate-limit denials return
 * `rate_limited` with retry_after_seconds — never `inactive`.
 */
export async function runCheckReferralCode(
  rawCode: string,
  deps: RunCheckReferralCodeDeps
): Promise<ReferralCodeCheckResult> {
  const ip = await deps.getClientIp();
  if (!ip || !ip.trim()) {
    return { status: "error" };
  }

  const decision = await deps.takeRateLimit(ip);
  if (decision.outcome === "error") {
    return { status: "error" };
  }
  if (decision.outcome === "rate_limited") {
    return {
      status: "rate_limited",
      retry_after_seconds: decision.retry_after_seconds,
    };
  }

  return checkReferralCodeStatus(rawCode, {
    lookupByNormalizedCode: deps.lookupByNormalizedCode,
  });
}
