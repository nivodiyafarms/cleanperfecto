import type { CalculationResult } from "./types";

/**
 * The single, authoritative customer-facing price for a residential
 * cleaning — owner-approved 2026-09-27: the UPPER BOUND of the existing
 * post-discount display range (buildEstimateRange's own `upper`, already
 * computed AFTER whatever discount/promotion program the pricing engine
 * selected — see discount-program.ts). Never `calculatedTotal` directly:
 * that raw figure is what the range's LOWER bound is rounded up from, not
 * what the customer is shown as "the price." Never recalculated here —
 * this reads the exact number already produced by calculateEstimate().
 *
 * Every consumer that both DISPLAYS a price to the customer and PERSISTS a
 * booking amount must read this exact same value, so the two can never
 * drift (e.g. customer sees $149, booking must persist $149 — never a
 * midpoint, minimum, or the raw pre-range calculatedTotal).
 *
 * Falls back to calculatedTotal only when no range exists (manual-review,
 * including every commercial request) — matching this codebase's existing
 * displayRangeLower/Upper null-safety convention. Not reachable for a
 * genuinely bookable instant-range result.
 */
export function resolveCustomerBookingPrice(result: CalculationResult): number {
  return result.range?.upper ?? result.calculatedTotal;
}
