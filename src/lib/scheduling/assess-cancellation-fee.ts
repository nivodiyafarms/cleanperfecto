import { CANCELLATION_POLICY_VERSION } from "@/lib/booking/cancellation-policy";
import type { FeeType } from "./types";

/**
 * Numeric form of the approved cancellation/rescheduling fee tiers already
 * displayed to customers via CANCELLATION_POLICY_TIERS in
 * src/lib/booking/cancellation-policy.ts ($25/$50/$75/free) — restated here
 * as structured constants for programmatic fee assessment. The display
 * copy remains that file's sole responsibility; these are the same
 * owner-approved amounts, not new numbers.
 */
export const CANCELLATION_FEE_SCHEDULE = {
  freeThresholdHours: 48,
  lateChangeThresholdHours: 24,
  lateChangeFee: 25,
  sameDayFee: 50,
  dispatchedNoAccessFee: 75,
} as const;

export interface FeeAssessmentResult {
  feeType: FeeType;
  amount: number;
  policyVersion: string;
}

/**
 * Computes the fee owed for a cancellation/reschedule/no-access event, per
 * the approved policy. Pure given an explicit `now` (same pattern as
 * calculateEstimate's `asOf` and getActiveFirstCleaningOffer). "no_access"
 * always assesses the flat dispatched/no-access fee regardless of notice;
 * "cancellation"/"reschedule" are assessed from hours of notice given
 * before `originalConfirmedStartAt` (the visit's confirmed time BEFORE this
 * change — a reschedule/cancellation of an already-scheduled visit).
 */
export function assessFee(feeType: FeeType, now: Date, originalConfirmedStartAt: Date): FeeAssessmentResult {
  if (feeType === "no_access") {
    return { feeType, amount: CANCELLATION_FEE_SCHEDULE.dispatchedNoAccessFee, policyVersion: CANCELLATION_POLICY_VERSION };
  }

  const hoursNotice = (originalConfirmedStartAt.getTime() - now.getTime()) / (60 * 60 * 1000);

  let amount: number;
  if (hoursNotice >= CANCELLATION_FEE_SCHEDULE.freeThresholdHours) {
    amount = 0;
  } else if (hoursNotice >= CANCELLATION_FEE_SCHEDULE.lateChangeThresholdHours) {
    amount = CANCELLATION_FEE_SCHEDULE.lateChangeFee;
  } else {
    amount = CANCELLATION_FEE_SCHEDULE.sameDayFee;
  }

  return { feeType, amount, policyVersion: CANCELLATION_POLICY_VERSION };
}
