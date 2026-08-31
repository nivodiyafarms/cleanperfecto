/**
 * Move-In/Move-Out Complete package upgrade — owner-approved hotfix,
 * 2026-08-30. Complete = Basic + a one-time bundled upgrade banded by
 * property square footage, folding in Refrigerator/Oven/Cabinet Interior
 * (see add-ons.ts's splitCompletePackageAddOns for the double-charge
 * prevention). Beyond the configured limit, Complete itself requires a
 * custom quote — Basic must remain calculable regardless (see
 * calculate-estimate.ts).
 */
export interface MoveCompleteUpgradeBand {
  /** Inclusive upper bound of this band's square footage. */
  maxSqFt: number;
  amount: number;
}

/**
 * Boundaries are inclusive at the upper edge of each band (e.g. exactly
 * 1,500 sq ft is +$50; 1,501 sq ft is +$65). Beyond 4,500 sq ft, Complete
 * requires manual/custom pricing rather than an invented amount.
 */
export const MOVE_COMPLETE_UPGRADE_CONFIG: MoveCompleteUpgradeBand[] = [
  { maxSqFt: 1500, amount: 50 },
  { maxSqFt: 2500, amount: 65 },
  { maxSqFt: 3500, amount: 80 },
  { maxSqFt: 4500, amount: 100 },
];

export type MoveCompleteUpgradeResult =
  | { configured: true; amount: number }
  | { configured: false; reason: "MOVE_COMPLETE_UPGRADE_NOT_CONFIGURED" };

/** Deterministic: the same square footage always resolves to the same upgrade amount for a given config. */
export function getMoveCompleteUpgrade(
  squareFeet: number,
  config: MoveCompleteUpgradeBand[] = MOVE_COMPLETE_UPGRADE_CONFIG
): MoveCompleteUpgradeResult {
  const band = config.find((entry) => squareFeet <= entry.maxSqFt);
  if (!band) {
    return { configured: false, reason: "MOVE_COMPLETE_UPGRADE_NOT_CONFIGURED" };
  }
  return { configured: true, amount: band.amount };
}
