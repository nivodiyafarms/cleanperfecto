import type { CalculationInput, CalculationResult, EstimateType } from "@/lib/pricing/types";

export interface PricingSnapshot {
  input: CalculationInput;
  result: CalculationResult;
}

/** Immutable { input, result } snapshot persisted verbatim into quote_requests.pricing_snapshot (jsonb) — see that column's comment in the approved migration. */
export function buildPricingSnapshot(input: CalculationInput, result: CalculationResult): PricingSnapshot {
  return { input, result };
}

/**
 * The pricing engine's EstimateType ("instant-range" / "manual-review") uses
 * hyphens; the DB CHECK constraint on quote_requests.estimate_type requires
 * underscores ("instant_range" / "manual_review"). This is the sole place
 * that translation happens.
 */
export function mapEstimateTypeToDb(estimateType: EstimateType): "instant_range" | "manual_review" {
  return estimateType === "instant-range" ? "instant_range" : "manual_review";
}
