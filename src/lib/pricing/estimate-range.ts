import { MINIMUM_SERVICE_TOTAL, RANGE_MINIMUM_GAP, RANGE_MULTIPLIERS, RANGE_ROUNDING_INCREMENT } from "./config";
import { roundToCents } from "./money";
import type { Condition, EstimateRange } from "./types";

function roundUpToIncrement(value: number, increment: number): number {
  // Round to the cent first so float noise (e.g. 400 * 1.1 === 440.00000000000006
  // in IEEE 754) never pushes an exact multiple up to the next increment.
  return Math.ceil(roundToCents(value) / increment) * increment;
}

/**
 * Builds the customer-facing display range around an authoritative
 * calculated total (owner-approved 2026-08-13 range rules). Presentation
 * logic only — never mutates or feeds back into the authoritative total.
 *
 * Lower bound: the calculated total rounded UP to the next $5, never below
 * the calculated total itself, and never below $99 — except when the $99
 * floor rule itself produced the total (`minimumServiceTotalApplied`), in
 * which case the lower bound stays exactly $99 rather than rounding up to
 * $100.
 *
 * Upper bound: the larger of (a) the condition's percentage spread applied
 * to the calculated total, or (b) the lower bound plus the condition's
 * minimum dollar gap — then rounded UP to the next $5. The dollar gaps are
 * floors, not ceilings: a big enough job's percentage spread can exceed
 * them naturally.
 */
export function buildEstimateRange(
  calculatedTotal: number,
  condition: Condition,
  minimumServiceTotalApplied: boolean
): EstimateRange {
  const lower = minimumServiceTotalApplied
    ? MINIMUM_SERVICE_TOTAL
    : Math.max(MINIMUM_SERVICE_TOTAL, roundUpToIncrement(calculatedTotal, RANGE_ROUNDING_INCREMENT));

  const percentageUpper = calculatedTotal * RANGE_MULTIPLIERS[condition];
  const minimumGapUpper = lower + RANGE_MINIMUM_GAP[condition];
  const upper = roundUpToIncrement(Math.max(percentageUpper, minimumGapUpper), RANGE_ROUNDING_INCREMENT);

  return { lower, upper };
}
