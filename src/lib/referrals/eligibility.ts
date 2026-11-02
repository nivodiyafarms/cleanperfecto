import { REFERRAL_MIN_CLEANING_DOLLARS } from "./constants";
import { assessReferralPricing, type ReferralDiscountProgram, type ReferralPricingAssessmentInput } from "./pricing-assessment";

export type { ReferralDiscountProgram };

/**
 * The $150 check uses the cleaning price after recurring-rate adjustments
 * and before this credit. Add-ons, customization, travel, supplies, tax,
 * tips, and other excluded charges do not count. Recurring-cycle pricing
 * is the cleaning rate. First-cleaning offers, prepaid packages, and custom
 * promotional discounts block the credit.
 */
export function referralRedemptionBlockReason(
  input: {
    role: "friend" | "referrer";
    visitId: string;
    qualifyingVisitId: string | null;
    priorCompletedVisitCount: number;
  } & ReferralPricingAssessmentInput
): string | null {
  const assessment = assessReferralPricing(input);
  if (assessment.stackingBlocked) {
    return assessment.stackingSignal === "prepaid_package" ? "PREPAID_PACKAGE" : "OTHER_DISCOUNT";
  }
  if (input.role === "friend") {
    if (input.qualifyingVisitId && input.visitId === input.qualifyingVisitId) return "FRIEND_FIRST_VISIT";
    if (input.priorCompletedVisitCount < 1) return "FRIEND_SECOND_CLEANING_REQUIRED";
  }
  if (assessment.eligibleCleaningAmount < REFERRAL_MIN_CLEANING_DOLLARS) return "BELOW_MINIMUM";
  return null;
}
