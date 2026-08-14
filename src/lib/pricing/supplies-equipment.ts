import type { CleaningType } from "./types";

export interface SuppliesEquipmentRule {
  cleaningType: CleaningType;
  /** Inclusive lower bound of the square-footage band this rule covers. */
  minSqFt: number;
  /** Inclusive upper bound of the square-footage band this rule covers. */
  maxSqFt: number;
  amount: number;
}

export type SuppliesEquipmentLookupResult =
  | { configured: true; amount: number }
  | { configured: false; reason: "SUPPLIES_EQUIPMENT_NOT_CONFIGURED" };

/**
 * Production supplies/equipment table, owner-approved 2026-08-13. A fixed
 * per-visit amount by cleaning type × square-footage band — never a flat
 * universal charge, never a percentage. Bands: up to 1,000 / 1,001–2,200 /
 * 2,201–3,000 / 3,001–4,500 sq ft; beyond 4,500 sq ft requires manual
 * review rather than an invented amount.
 *
 * The approved table also lists a distinct "Airbnb" column. Airbnb is
 * modeled as a PropertyKind, not a CleaningType, so it doesn't fit this
 * lookup's (CleaningType × sq ft) key shape — see AIRBNB_SUPPLIES_CONFIG
 * and getAirbnbSuppliesCharge below for its own parallel, sq-ft-only
 * table. calculate-estimate.ts branches on `propertyKind === "airbnb"`
 * to choose which of the two tables applies; a booking's selected
 * CleaningType (Standard/Deep/Move) never determines the Airbnb rate.
 */
export const SUPPLIES_EQUIPMENT_CONFIG: SuppliesEquipmentRule[] = [
  // Up to 1,000 sq ft
  { cleaningType: "standard", minSqFt: 0, maxSqFt: 1000, amount: 15 },
  { cleaningType: "deep", minSqFt: 0, maxSqFt: 1000, amount: 25 },
  { cleaningType: "move", minSqFt: 0, maxSqFt: 1000, amount: 25 },
  // 1,001-2,200 sq ft
  { cleaningType: "standard", minSqFt: 1001, maxSqFt: 2200, amount: 22.5 },
  { cleaningType: "deep", minSqFt: 1001, maxSqFt: 2200, amount: 30 },
  { cleaningType: "move", minSqFt: 1001, maxSqFt: 2200, amount: 32.5 },
  // 2,201-3,000 sq ft
  { cleaningType: "standard", minSqFt: 2201, maxSqFt: 3000, amount: 27.5 },
  { cleaningType: "deep", minSqFt: 2201, maxSqFt: 3000, amount: 35 },
  { cleaningType: "move", minSqFt: 2201, maxSqFt: 3000, amount: 40 },
  // 3,001-4,500 sq ft
  { cleaningType: "standard", minSqFt: 3001, maxSqFt: 4500, amount: 32.5 },
  { cleaningType: "deep", minSqFt: 3001, maxSqFt: 4500, amount: 42.5 },
  { cleaningType: "move", minSqFt: 3001, maxSqFt: 4500, amount: 47.5 },
];

/**
 * Deterministic: the same (cleaningType, squareFeet) always resolves to the
 * same amount for a given config. Square footage beyond the configured
 * range (or a cleaning type with no matching band) returns a typed
 * manual-review reason rather than a guessed amount.
 */
export function getSuppliesEquipmentCharge(
  cleaningType: CleaningType,
  squareFeet: number,
  config: SuppliesEquipmentRule[] = SUPPLIES_EQUIPMENT_CONFIG
): SuppliesEquipmentLookupResult {
  const match = config.find(
    (rule) => rule.cleaningType === cleaningType && squareFeet >= rule.minSqFt && squareFeet <= rule.maxSqFt
  );
  if (!match) {
    return { configured: false, reason: "SUPPLIES_EQUIPMENT_NOT_CONFIGURED" };
  }
  return { configured: true, amount: match.amount };
}

export interface AirbnbSuppliesRule {
  /** Inclusive lower bound of the square-footage band this rule covers. */
  minSqFt: number;
  /** Inclusive upper bound of the square-footage band this rule covers. */
  maxSqFt: number;
  amount: number;
}

/**
 * Production Airbnb supplies/equipment table, owner-approved 2026-08-13.
 * Applies whenever propertyKind === "airbnb", regardless of the booking's
 * selected CleaningType — Airbnb has one supplies rate per sq-ft band, not
 * one per cleaning type. Same band boundaries as SUPPLIES_EQUIPMENT_CONFIG;
 * beyond 4,500 sq ft requires manual review, never an invented amount.
 */
export const AIRBNB_SUPPLIES_CONFIG: AirbnbSuppliesRule[] = [
  { minSqFt: 0, maxSqFt: 1000, amount: 15 },
  { minSqFt: 1001, maxSqFt: 2200, amount: 20 },
  { minSqFt: 2201, maxSqFt: 3000, amount: 25 },
  { minSqFt: 3001, maxSqFt: 4500, amount: 30 },
];

/**
 * Deterministic: the same squareFeet always resolves to the same amount for
 * a given config. Square footage beyond the configured range returns a
 * typed manual-review reason rather than a guessed amount.
 */
export function getAirbnbSuppliesCharge(
  squareFeet: number,
  config: AirbnbSuppliesRule[] = AIRBNB_SUPPLIES_CONFIG
): SuppliesEquipmentLookupResult {
  const match = config.find((rule) => squareFeet >= rule.minSqFt && squareFeet <= rule.maxSqFt);
  if (!match) {
    return { configured: false, reason: "SUPPLIES_EQUIPMENT_NOT_CONFIGURED" };
  }
  return { configured: true, amount: match.amount };
}
