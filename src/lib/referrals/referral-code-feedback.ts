import { normalizeReferralCode } from "./codes";
import type { ReferralCodeCheckStatus } from "./check-referral-code-status";
import {
  REFERRAL_CODE_APPLIED_MESSAGE,
  REFERRAL_CODE_CHECK_FAILED_MESSAGE,
  REFERRAL_CODE_INACTIVE_MESSAGE,
} from "./copy";

export type ReferralCodeFeedbackKind = "none" | ReferralCodeCheckStatus;

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
  let settledStatus: ReferralCodeCheckStatus | null = null;
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
        settledStatus = null;
        inFlightCodeKey = null;
        latestRequestId += 1;
        return { skip: true, reason: "empty" };
      }

      const key = codeKey(raw);
      if (!options.force && settledCodeKey === key && settledStatus !== null && inFlightCodeKey === null) {
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

    accept(requestId: number, key: string, status: ReferralCodeCheckStatus): boolean {
      if (requestId !== latestRequestId) return false;
      settledCodeKey = key;
      settledStatus = status;
      inFlightCodeKey = null;
      return true;
    },

    /** Field changed — drop feedback and invalidate in-flight results. */
    clearOnFieldChange(): void {
      settledCodeKey = null;
      settledStatus = null;
      inFlightCodeKey = null;
      latestRequestId += 1;
    },

    getSettled(): { codeKey: string; status: ReferralCodeCheckStatus } | null {
      if (settledCodeKey === null || settledStatus === null) return null;
      return { codeKey: settledCodeKey, status: settledStatus };
    },
  };
}

export function messageForReferralCodeStatus(status: ReferralCodeCheckStatus): string {
  switch (status) {
    case "valid":
      return REFERRAL_CODE_APPLIED_MESSAGE;
    case "inactive":
      return REFERRAL_CODE_INACTIVE_MESSAGE;
    case "error":
      return REFERRAL_CODE_CHECK_FAILED_MESSAGE;
  }
}
