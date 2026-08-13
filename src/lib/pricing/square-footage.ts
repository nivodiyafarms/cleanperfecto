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
 * Production square-footage table — intentionally empty until real
 * included-allowance / band / limit values are approved (owner message
 * 2026-08-12, item 4). A customer who never provides square footage skips
 * this lookup entirely (multiplier stays 1.00, no manual review) — this
 * table only matters once square footage IS supplied. Tests must inject
 * their own fixtures via the `config` parameter, never this array.
 */
export const SQUARE_FOOTAGE_CONFIG: SquareFootageBand[] = [];

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
