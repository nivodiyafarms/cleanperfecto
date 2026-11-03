import { normalizeReferralCode } from "./codes";
import type {
  ReferralCodeCheckResult,
  ReferralCodeCheckStatus,
} from "./check-referral-code-status";
import {
  REFERRAL_CODE_APPLIED_MESSAGE,
  REFERRAL_CODE_CHECK_FAILED_MESSAGE,
  REFERRAL_CODE_INACTIVE_MESSAGE,
  referralCodeRateLimitedMessage,
} from "./copy";

export type ReferralCodeFeedbackKind = "none" | ReferralCodeCheckStatus;

export type ReferralCodeFeedbackState = ReferralCodeCheckResult | null;

/**
 * Tracks in-flight / completed checks so the UI can:
 * - skip empty values
 * - dedupe identical codes while a prior result is still current
 * - ignore stale responses after the field changes or a newer check starts
 * - force a fresh server revalidation on submit
 */
export function createReferralCodeCheckTracker() {
  let nextRequestId = 0;
  let latestRequestId = 0;
  let settledCodeKey: string | null = null;
  let settledResult: ReferralCodeCheckResult | null = null;
  let inFlightCodeKey: string | null = null;

  function codeKey(raw: string): string {
    const trimmed = raw.trim();
    return normalizeReferralCode(trimmed) ?? trimmed.toUpperCase();
  }

  return {
    /** Empty field — no network check; clear any prior feedback. */
    shouldSkip(raw: string): boolean {
      return raw.trim().length === 0;
    },

    /**
     * Start a check. Returns `skip` when empty or when a non-forced check
     * already settled for the same code. Otherwise returns a request id the
     * caller must pass back to `accept`.
     */
    begin(
      raw: string,
      options: { force?: boolean } = {}
    ): { skip: true; reason: "empty" | "deduped" } | { skip: false; requestId: number; codeKey: string } {
      if (raw.trim().length === 0) {
        settledCodeKey = null;
        settledResult = null;
        inFlightCodeKey = null;
        latestRequestId += 1;
        return { skip: true, reason: "empty" };
      }

      const key = codeKey(raw);
      if (!options.force && settledCodeKey === key && settledResult !== null && inFlightCodeKey === null) {
        return { skip: true, reason: "deduped" };
      }
      if (!options.force && inFlightCodeKey === key) {
        return { skip: true, reason: "deduped" };
      }

      nextRequestId += 1;
      latestRequestId = nextRequestId;
      inFlightCodeKey = key;
      return { skip: false, requestId: latestRequestId, codeKey: key };
    },

    /** True when a newer begin/clear happened after this request started. */
    isStale(requestId: number): boolean {
      return requestId !== latestRequestId;
    },

    accept(requestId: number, key: string, result: ReferralCodeCheckResult): boolean {
      if (requestId !== latestRequestId) return false;
      settledCodeKey = key;
      settledResult = result;
      inFlightCodeKey = null;
      return true;
    },

    /** Field changed — drop feedback and invalidate in-flight results. */
    clearOnFieldChange(): void {
      settledCodeKey = null;
      settledResult = null;
      inFlightCodeKey = null;
      latestRequestId += 1;
    },

    getSettled(): { codeKey: string; result: ReferralCodeCheckResult } | null {
      if (settledCodeKey === null || settledResult === null) return null;
      return { codeKey: settledCodeKey, result: settledResult };
    },
  };
}

export function messageForReferralCodeStatus(result: ReferralCodeCheckResult): string {
  switch (result.status) {
    case "valid":
      return REFERRAL_CODE_APPLIED_MESSAGE;
    case "inactive":
      return REFERRAL_CODE_INACTIVE_MESSAGE;
    case "error":
      return REFERRAL_CODE_CHECK_FAILED_MESSAGE;
    case "rate_limited":
      return referralCodeRateLimitedMessage(result.retry_after_seconds);
  }
}
