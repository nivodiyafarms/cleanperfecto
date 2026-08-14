import { SIZE_TIER_BASELINE_ROOMS } from "./config";
import type { CleaningType, RoomCounts, SizeTier } from "./types";

export interface RoomAdjustmentRates {
  additionalBedroomCharge: number | null;
  additionalFullBathroomCharge: number | null;
  additionalHalfBathroomCharge: number | null;
}

/** Keyed by CleaningType — Standard's rates differ from Deep/Move-In-Out's (owner-approved 2026-08-13). */
export type RoomAdjustmentConfig = Record<CleaningType, RoomAdjustmentRates>;

export type RoomAdjustmentResult =
  | { configured: true; amount: number }
  | { configured: false; reason: "ROOM_ADJUSTMENT_NOT_CONFIGURED" };

/**
 * Production room-adjustment charges, owner-approved 2026-08-13. Move-In/
 * Move-Out shares Deep Cleaning's rates (CLAUDE.md "Move-In / Move-Out
 * Caution" — no separate Move-specific room-adjustment table was approved).
 * A customer whose actual room counts fit within (or below) their size
 * tier's baseline never needs this config at all — it only matters once
 * extra rooms are reported.
 */
export const ROOM_ADJUSTMENT_CONFIG: RoomAdjustmentConfig = {
  standard: {
    additionalBedroomCharge: 20,
    additionalFullBathroomCharge: 25,
    additionalHalfBathroomCharge: 12.5,
  },
  deep: {
    additionalBedroomCharge: 25,
    additionalFullBathroomCharge: 30,
    additionalHalfBathroomCharge: 15,
  },
  move: {
    additionalBedroomCharge: 25,
    additionalFullBathroomCharge: 30,
    additionalHalfBathroomCharge: 15,
  },
};

/**
 * Deterministic: the same (cleaningType, sizeTier, rooms) always resolves to
 * the same amount for a given config. An adjustment that's needed but
 * unconfigured returns a typed manual-review reason rather than a guessed
 * amount.
 */
export function getRoomAdjustment(
  cleaningType: CleaningType,
  sizeTier: SizeTier,
  rooms: RoomCounts | undefined,
  config: RoomAdjustmentConfig = ROOM_ADJUSTMENT_CONFIG
): RoomAdjustmentResult {
  if (!rooms) {
    return { configured: true, amount: 0 };
  }

  const baseline = SIZE_TIER_BASELINE_ROOMS[sizeTier];
  const extraBedrooms = Math.max(0, rooms.bedrooms - baseline.bedrooms);
  const extraFullBaths = Math.max(0, rooms.fullBathrooms - baseline.fullBathrooms);
  const extraHalfBaths = Math.max(0, rooms.halfBathrooms - baseline.halfBathrooms);

  if (extraBedrooms === 0 && extraFullBaths === 0 && extraHalfBaths === 0) {
    return { configured: true, amount: 0 };
  }

  const rates = config[cleaningType];

  const missingConfig =
    (extraBedrooms > 0 && rates.additionalBedroomCharge === null) ||
    (extraFullBaths > 0 && rates.additionalFullBathroomCharge === null) ||
    (extraHalfBaths > 0 && rates.additionalHalfBathroomCharge === null);

  if (missingConfig) {
    return { configured: false, reason: "ROOM_ADJUSTMENT_NOT_CONFIGURED" };
  }

  const amount =
    extraBedrooms * (rates.additionalBedroomCharge ?? 0) +
    extraFullBaths * (rates.additionalFullBathroomCharge ?? 0) +
    extraHalfBaths * (rates.additionalHalfBathroomCharge ?? 0);

  return { configured: true, amount };
}
