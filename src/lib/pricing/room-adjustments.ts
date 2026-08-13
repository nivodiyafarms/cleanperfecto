import { SIZE_TIER_BASELINE_ROOMS } from "./config";
import type { RoomCounts, SizeTier } from "./types";

export interface RoomAdjustmentConfig {
  additionalBedroomCharge: number | null;
  additionalFullBathroomCharge: number | null;
  additionalHalfBathroomCharge: number | null;
}

export type RoomAdjustmentResult =
  | { configured: true; amount: number }
  | { configured: false; reason: "ROOM_ADJUSTMENT_NOT_CONFIGURED" };

/**
 * Production room-adjustment charges — intentionally unconfigured (all
 * null) until approved (owner message 2026-08-12, item 5). A customer whose
 * actual room counts fit within (or below) their size tier's baseline never
 * needs this config at all — it only matters once extra rooms are reported.
 * Tests must inject their own fixture via the `config` parameter, never this
 * constant.
 */
export const ROOM_ADJUSTMENT_CONFIG: RoomAdjustmentConfig = {
  additionalBedroomCharge: null,
  additionalFullBathroomCharge: null,
  additionalHalfBathroomCharge: null,
};

export function getRoomAdjustment(
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

  const missingConfig =
    (extraBedrooms > 0 && config.additionalBedroomCharge === null) ||
    (extraFullBaths > 0 && config.additionalFullBathroomCharge === null) ||
    (extraHalfBaths > 0 && config.additionalHalfBathroomCharge === null);

  if (missingConfig) {
    return { configured: false, reason: "ROOM_ADJUSTMENT_NOT_CONFIGURED" };
  }

  const amount =
    extraBedrooms * (config.additionalBedroomCharge ?? 0) +
    extraFullBaths * (config.additionalFullBathroomCharge ?? 0) +
    extraHalfBaths * (config.additionalHalfBathroomCharge ?? 0);

  return { configured: true, amount };
}
