import { calculateEstimate } from "@/lib/pricing/calculate-estimate";
import type { CalculationInput, CalculationResult, EstimateRange } from "@/lib/pricing/types";

export interface EstimateWithComparison {
  result: CalculationResult;
  /**
   * The customer-facing range they'd see WITHOUT the first-cleaning offer,
   * computed by rerunning the exact same trusted pricing engine with only
   * `firstCleaningEligible` forced to false — same base price, same room/
   * sqft/condition adjustments, same travel, same supplies, same recurring-
   * cycle or prepaid-package discount if any of those still apply on their
   * own. No pricing formula is duplicated; this is the engine's own answer
   * to "what would this same request cost without the first-cleaning
   * special". Non-null only when `result.discountProgram === "first_cleaning"`
   * — i.e. only when the first-cleaning offer is what's actually being
   * applied to this quote. Presentation/reference only: never persisted,
   * never fed back into `result` or the authoritative pricing_snapshot.
   */
  regularRange: EstimateRange | null;
}

/**
 * Shared by both submitInstantQuote (the persisting core) and
 * previewInstantQuoteCustomization (the non-persisting post-estimate
 * preview) so the "regular vs. first-cleaning" comparison logic exists in
 * exactly one place.
 */
export function calculateEstimateWithComparison(input: CalculationInput): EstimateWithComparison {
  const result = calculateEstimate(input);

  if (result.discountProgram !== "first_cleaning") {
    return { result, regularRange: null };
  }

  const regularResult = calculateEstimate({ ...input, firstCleaningEligible: false });
  return { result, regularRange: regularResult.range };
}
