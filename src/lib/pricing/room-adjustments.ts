import { SIZE_TIER_BASELINE_ROOMS } from "./config";
import type { CleaningType, RoomCounts, SizeTier, SpecialRoomChargeResult, SpecialRoomId } from "./types";

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

// ---------------------------------------------------------------------------
// Special (dedicated) rooms — Game Room / Media-Theater Room, owner-approved
// hotfix 2026-08-30. A separate function rather than folding into
// getRoomAdjustment's own signature/return shape, so every existing call
// site and test above is unaffected; the caller (calculate-estimate.ts)
// combines both amounts into the same pre-multiplier roomAdjustments total,
// reusing the exact same "keyed by CleaningType" config pattern.
// ---------------------------------------------------------------------------

export const SPECIAL_ROOM_LABELS: Record<SpecialRoomId, string> = {
  game_room: "Game Room",
  media_room: "Media / Theater Room",
};

export type SpecialRoomConfig = Record<CleaningType, Partial<Record<SpecialRoomId, number>>>;

/** Production special-room charges, owner-approved 2026-08-30. */
export const SPECIAL_ROOM_CONFIG: SpecialRoomConfig = {
  standard: { game_room: 15, media_room: 15 },
  deep: { game_room: 20, media_room: 20 },
  move: { game_room: 20, media_room: 20 },
};

export type SpecialRoomResult =
  | { configured: true; amount: number; charges: SpecialRoomChargeResult[] }
  | { configured: false; reason: "ROOM_ADJUSTMENT_NOT_CONFIGURED" };

/** Deduplicates repeated selections so a double-submitted room can't double-charge. */
export function getSpecialRoomCharges(
  cleaningType: CleaningType,
  specialRooms: SpecialRoomId[] | undefined,
  config: SpecialRoomConfig = SPECIAL_ROOM_CONFIG
): SpecialRoomResult {
  if (!specialRooms || specialRooms.length === 0) {
    return { configured: true, amount: 0, charges: [] };
  }

  const rates = config[cleaningType];
  const charges: SpecialRoomChargeResult[] = [];

  for (const id of new Set(specialRooms)) {
    const rate = rates[id];
    if (rate === undefined) {
      return { configured: false, reason: "ROOM_ADJUSTMENT_NOT_CONFIGURED" };
    }
    charges.push({ id, label: SPECIAL_ROOM_LABELS[id], amount: rate });
  }

  const amount = charges.reduce((sum, charge) => sum + charge.amount, 0);
  return { configured: true, amount, charges };
}
