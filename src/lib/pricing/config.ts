import type { CleaningType, Condition, FrequencyId, SizeTier } from "./types";

export const PRICING_VERSION = "pricing-engine-2026-08";

/** Hard backend floor — final service total may never fall below this, regardless of discount. */
export const MINIMUM_SERVICE_TOTAL = 99;

/** Customer-facing range values round up to this increment. */
export const RANGE_ROUNDING_INCREMENT = 5;

/**
 * Minimum displayed dollar gap between the range's lower and upper bound, by
 * condition (owner-approved 2026-08-13). These are floors, not ceilings — a
 * large enough job will naturally produce a wider range via RANGE_MULTIPLIERS
 * below; whichever spread is larger wins. See estimate-range.ts.
 */
export const RANGE_MINIMUM_GAP: Record<Condition, number> = {
  light: 20,
  moderate: 25,
  heavy: 30,
  extensive: 30,
};

export const PACKAGE_MIN_VISITS = 6;
export const PACKAGE_DISCOUNT_MULTIPLIER = 0.8;

/**
 * Approved public base prices (CLAUDE.md "Approved Starting Prices" /
 * owner-approved 2026-08-12). Move-In/Move-Out uses a single flat starting
 * base rather than a per-tier table — see MOVE_BASE_PRICE.
 */
export const BASE_PRICES: Record<Exclude<CleaningType, "move">, Record<SizeTier, number>> = {
  standard: {
    studio_1ba: 109,
    "1br_1ba": 129,
    "2br_2ba": 149,
    "3br_2ba": 179,
    "4br_plus": 209,
  },
  deep: {
    studio_1ba: 169,
    "1br_1ba": 199,
    "2br_2ba": 229,
    "3br_2ba": 279,
    "4br_plus": 329,
  },
};

export const MOVE_BASE_PRICE = 199;

/**
 * Condition multipliers, owner-approved 2026-08-12 (item 6: Move-In/Move-Out
 * uses the same table as Deep Cleaning). A missing key means the combination
 * is not offered — e.g. Standard + Extensive does not exist.
 */
export const CONDITION_MULTIPLIERS: Record<CleaningType, Partial<Record<Condition, number>>> = {
  standard: { light: 1.0, moderate: 1.0, heavy: 1.15 },
  deep: { light: 1.0, moderate: 1.0, heavy: 1.15, extensive: 1.2 },
  move: { light: 1.0, moderate: 1.0, heavy: 1.15, extensive: 1.2 },
};

/**
 * Customer-facing range ceiling applied to the server-calculated total, by
 * condition. Moderate confirmed at +7% by owner 2026-08-12 — this supersedes
 * an earlier +5% mention for Moderate in the same message.
 */
export const RANGE_MULTIPLIERS: Record<Condition, number> = {
  light: 1.05,
  moderate: 1.07,
  heavy: 1.1,
  extensive: 1.15,
};

/** Recurring-cycle multipliers, owner-approved 2026-08-12 (item 15). */
export const RECURRING_MULTIPLIERS: Partial<Record<FrequencyId, number>> = {
  weekly: 0.79,
  biweekly: 0.86,
  every_4_weeks: 0.93,
};

/**
 * Structural baseline room counts implied by each approved size-tier label
 * (e.g. "3 Bedroom / 2 Bath Home"). These are facts drawn directly from the
 * already-approved tier names, not invented pricing — used only to
 * determine how many *additional* rooms (if any) a customer's actual counts
 * represent for room-adjustments.ts. 4br_plus's baseline is explicitly "4
 * Bedroom / up to 3 Bath" per owner-approved 2026-08-13 base room
 * assumptions — a 4th full bathroom is included at this tier; only a 5th+
 * bedroom or 4th+ full bathroom triggers an adjustment.
 */
export const SIZE_TIER_BASELINE_ROOMS: Record<
  SizeTier,
  { bedrooms: number; fullBathrooms: number; halfBathrooms: number }
> = {
  studio_1ba: { bedrooms: 0, fullBathrooms: 1, halfBathrooms: 0 },
  "1br_1ba": { bedrooms: 1, fullBathrooms: 1, halfBathrooms: 0 },
  "2br_2ba": { bedrooms: 2, fullBathrooms: 2, halfBathrooms: 0 },
  "3br_2ba": { bedrooms: 3, fullBathrooms: 2, halfBathrooms: 0 },
  "4br_plus": { bedrooms: 4, fullBathrooms: 3, halfBathrooms: 0 },
};
