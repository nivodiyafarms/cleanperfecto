import { normalizeReferralCode } from "./codes";

/**
 * Public quote-page check result. Intentionally status-only — never carries
 * owner, customer, code type (A/B), or recipient-label ('Given to') fields.
 */
export type ReferralCodeCheckStatus = "valid" | "inactive" | "error" | "rate_limited";

export type ReferralCodeLookupOutcome = "active" | "inactive" | "missing" | "error";

export interface CheckReferralCodeStatusDeps {
  lookupByNormalizedCode: (code: string) => Promise<ReferralCodeLookupOutcome>;
}

export type ReferralCodeCheckResult =
  | { status: "valid" | "inactive" | "error" }
  | { status: "rate_limited"; retry_after_seconds: number };

/**
 * Pure validation + lookup mapping used by the public check action and tests.
 * Format failures and missing/disabled rows all collapse to `inactive` so the
 * UI never distinguishes "never existed" from "turned off". DB/transport
 * failures stay `error` and must not be labeled invalid.
 */
export async function checkReferralCodeStatus(
  rawCode: string,
  deps: CheckReferralCodeStatusDeps
): Promise<ReferralCodeCheckResult> {
  const normalized = normalizeReferralCode(rawCode);
  if (!normalized) {
    return { status: "inactive" };
  }

  try {
    const outcome = await deps.lookupByNormalizedCode(normalized);
    if (outcome === "active") return { status: "valid" };
    if (outcome === "error") return { status: "error" };
    return { status: "inactive" };
  } catch {
    return { status: "error" };
  }
}
