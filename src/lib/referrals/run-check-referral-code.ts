import {
  checkReferralCodeStatus,
  type ReferralCodeCheckResult,
  type ReferralCodeLookupOutcome,
} from "./check-referral-code-status";

export type RunCheckReferralCodeDeps = {
  getClientIp: () => Promise<string | null>;
  takeRateLimit: (key: string) => { allowed: boolean };
  lookupByNormalizedCode: (code: string) => Promise<ReferralCodeLookupOutcome>;
};

/**
 * Shared implementation for the public check action. Kept free of the
 * `"use server"` boundary so unit tests can inject fakes without going
 * through the Next.js action serializer.
 */
export async function runCheckReferralCode(
  rawCode: string,
  deps: RunCheckReferralCodeDeps
): Promise<ReferralCodeCheckResult> {
  const ip = await deps.getClientIp();
  const rateKey = ip ? `ip:${ip}` : "ip:unknown";
  if (!deps.takeRateLimit(rateKey).allowed) {
    return { status: "error" };
  }

  return checkReferralCodeStatus(rawCode, {
    lookupByNormalizedCode: deps.lookupByNormalizedCode,
  });
}
