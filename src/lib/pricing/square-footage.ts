import type { SizeTier } from "./types";

export interface SquareFootageBand {
  sizeTier: SizeTier;
  /** Square footage included in the base price at multiplier 1.00. */
  includedSqFt: number;
  /** Size of each additional band beyond includedSqFt. */
  additionalBandSqFt: number;
  /** Multiplier added per additional band beyond includedSqFt. */
  multiplierPerBand: number;
  /** Sizes beyond this require manual review rather than an invented multiplier. */
  maxConfiguredSqFt: number;
}

export type SquareFootageLookupResult =
  | { configured: true; multiplier: number }
  | {
      configured: false;
      reason: "SQUARE_FOOTAGE_NOT_CONFIGURED" | "SQUARE_FOOTAGE_BEYOND_CONFIGURED_LIMIT";
    };

/**
 * Production square-footage table, owner-approved 2026-08-13. Square
 * footage is a secondary correction on top of the bedroom/bathroom-driven
 * base price — each tier gets a generous included allowance, then +5% per
 * additional 500 sq ft (partial bands round up to a full band), capped at
 * 3 bands (+15%, 1,500 sq ft above allowance) before requiring manual
 * review. Shared by Standard, Deep, and Move-In/Move-Out (all keyed by
 * SizeTier only — no separate table exists per cleaning type). A customer
 * who never provides square footage skips this lookup entirely (multiplier
 * stays 1.00, no manual review) — this table only matters once square
 * footage IS supplied. Tests must inject their own fixtures via the
 * `config` parameter, never this array.
 */
export const SQUARE_FOOTAGE_CONFIG: SquareFootageBand[] = [
  { sizeTier: "studio_1ba", includedSqFt: 750, additionalBandSqFt: 500, multiplierPerBand: 0.05, maxConfiguredSqFt: 2250 },
  { sizeTier: "1br_1ba", includedSqFt: 1000, additionalBandSqFt: 500, multiplierPerBand: 0.05, maxConfiguredSqFt: 2500 },
  { sizeTier: "2br_2ba", includedSqFt: 1600, additionalBandSqFt: 500, multiplierPerBand: 0.05, maxConfiguredSqFt: 3100 },
  { sizeTier: "3br_2ba", includedSqFt: 2200, additionalBandSqFt: 500, multiplierPerBand: 0.05, maxConfiguredSqFt: 3700 },
  { sizeTier: "4br_plus", includedSqFt: 3000, additionalBandSqFt: 500, multiplierPerBand: 0.05, maxConfiguredSqFt: 4500 },
];

/**
 * Resolves the square footage used as size *context* for modules that need
 * a concrete number even when the customer didn't supply one (currently:
 * supplies-equipment.ts). Falls back to the size tier's own included
 * allowance above — never an invented number. Returns null only if the
 * given config has no entry for the size tier at all (e.g. an isolated
 * test fixture), in which case the caller should treat size as unresolved.
 */
export function resolveDefaultSquareFeet(
  sizeTier: SizeTier,
  config: SquareFootageBand[] = SQUARE_FOOTAGE_CONFIG
): number | null {
  const band = config.find((entry) => entry.sizeTier === sizeTier);
  return band ? band.includedSqFt : null;
}

export function getSquareFootageMultiplier(
  sizeTier: SizeTier,
  squareFeet: number,
  config: SquareFootageBand[] = SQUARE_FOOTAGE_CONFIG
): SquareFootageLookupResult {
  const band = config.find((entry) => entry.sizeTier === sizeTier);
  if (!band) {
    return { configured: false, reason: "SQUARE_FOOTAGE_NOT_CONFIGURED" };
  }
  if (squareFeet > band.maxConfiguredSqFt) {
    return { configured: false, reason: "SQUARE_FOOTAGE_BEYOND_CONFIGURED_LIMIT" };
  }
  if (squareFeet <= band.includedSqFt) {
    return { configured: true, multiplier: 1 };
  }
  const extraSqFt = squareFeet - band.includedSqFt;
  const bandsUsed = Math.ceil(extraSqFt / band.additionalBandSqFt);
  return { configured: true, multiplier: 1 + bandsUsed * band.multiplierPerBand };
}
