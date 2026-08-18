import {
  MANUAL_REVIEW_CUSTOMER_MESSAGE,
  type InstantQuoteEstimateDisplay,
  type InstantQuoteManualReviewDisplay,
} from "./instant-quote-estimate-display";
import type { EstimateWithComparison } from "./estimate-with-comparison";

/**
 * The customer-safe result of a POST-ESTIMATE customization preview — same
 * pricing-display shape as the initial estimate (instant-quote-request-
 * result.ts), but deliberately has no quoteId: nothing is persisted by a
 * preview, so there is no new row to reference. Never includes
 * customer_id, normalized identifiers, pricing_snapshot, or internal
 * manual_review_reasons codes.
 */
export type InstantQuoteCustomizationPreviewResult =
  | InstantQuoteCustomizationPreviewAutomatic
  | InstantQuoteCustomizationPreviewManualReview
  | InstantQuoteCustomizationPreviewValidationFailure
  | InstantQuoteCustomizationPreviewFailure;

export interface InstantQuoteCustomizationPreviewAutomatic extends InstantQuoteEstimateDisplay {
  success: true;
}

export interface InstantQuoteCustomizationPreviewManualReview extends InstantQuoteManualReviewDisplay {
  success: true;
}

export interface InstantQuoteCustomizationPreviewValidationFailure {
  success: false;
  stage: "validation";
  errors: string[];
}

export interface InstantQuoteCustomizationPreviewFailure {
  success: false;
  stage: "failed";
  message: string;
}

/**
 * Maps a raw calculateEstimateWithComparison output into the customer-safe
 * preview shape. Pure — no I/O, no trust decisions of its own.
 */
export function mapToCustomizationPreviewResult(
  estimate: EstimateWithComparison
): InstantQuoteCustomizationPreviewAutomatic | InstantQuoteCustomizationPreviewManualReview {
  const { result, regularRange } = estimate;

  if (result.estimateType === "manual-review" || result.range === null) {
    return {
      success: true,
      estimateType: "manual_review",
      manualReviewRequired: true,
      reasonCode: "custom_quote_required",
      customerMessage: MANUAL_REVIEW_CUSTOMER_MESSAGE,
    };
  }

  const firstCleaningOfferApplied = result.discountProgram === "first_cleaning";

  return {
    success: true,
    estimateType: "instant_range",
    manualReviewRequired: result.manualReviewRequired,
    displayRangeLower: result.range.lower,
    displayRangeUpper: result.range.upper,
    hasStartingAtPricing: result.hasStartingAtPricing,
    prepaidPackageTotal: result.prepaidPackageTotal,
    effectivePricePerVisit: result.effectivePricePerVisit,
    firstCleaningOfferApplied,
    regularDisplayRangeLower: firstCleaningOfferApplied ? (regularRange?.lower ?? null) : null,
    regularDisplayRangeUpper: firstCleaningOfferApplied ? (regularRange?.upper ?? null) : null,
  };
}
