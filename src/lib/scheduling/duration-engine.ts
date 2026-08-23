import { CONDITION_MULTIPLIERS, SIZE_TIER_BASELINE_ROOMS } from "@/lib/pricing/config";
import type { CleaningType, Condition, RoomCounts, SizeTier } from "@/lib/pricing/types";
import {
  BASE_LABOR_MINUTES,
  DURATION_ROOM_ADJUSTMENT_MINUTES,
  RECOMMENDED_CLEANER_COUNT,
  SERVICE_MINUTES_ROUNDING_INCREMENT,
} from "./config";

export interface DurationEstimateInput {
  cleaningType: CleaningType;
  sizeTier: SizeTier;
  condition: Condition;
  /** Actual bedroom/bathroom counts, same shape/meaning as pricing's CalculationInput.rooms — only affects the estimate once they exceed the size tier's baseline. */
  rooms?: RoomCounts;
}

export interface DurationEstimateResult {
  /** Total person-minutes of work (e.g. 2 cleaners x 180 min = 360). */
  estimatedLaborMinutes: number;
  recommendedCleanerCount: number;
  /** The calendar time the appointment actually blocks — what the scheduling engine reserves, distinct from estimatedLaborMinutes. Rounded up to SERVICE_MINUTES_ROUNDING_INCREMENT. */
  estimatedServiceMinutes: number;
}

function roundUpToIncrement(minutes: number, increment: number): number {
  return Math.ceil(minutes / increment) * increment;
}

/**
 * Pure duration/staffing estimate — mirrors calculateEstimate's purity
 * (src/lib/pricing/calculate-estimate.ts): same inputs always produce the
 * same result, no ambient state. Reuses the pricing engine's own
 * CONDITION_MULTIPLIERS and SIZE_TIER_BASELINE_ROOMS (owner-approved for
 * pricing) rather than inventing a parallel condition-scaling table.
 * BASE_LABOR_MINUTES and DURATION_ROOM_ADJUSTMENT_MINUTES in ./config.ts
 * are V1 PLACEHOLDERS, not yet owner-approved business facts — see that
 * file's own doc comment.
 */
export function estimateDuration(input: DurationEstimateInput): DurationEstimateResult {
  const baseMinutes = BASE_LABOR_MINUTES[input.cleaningType][input.sizeTier];

  const baseline = SIZE_TIER_BASELINE_ROOMS[input.sizeTier];
  const rooms = input.rooms;
  const extraBedrooms = rooms ? Math.max(0, rooms.bedrooms - baseline.bedrooms) : 0;
  const extraFullBaths = rooms ? Math.max(0, rooms.fullBathrooms - baseline.fullBathrooms) : 0;
  const extraHalfBaths = rooms ? Math.max(0, rooms.halfBathrooms - baseline.halfBathrooms) : 0;

  const roomAdjustmentMinutes =
    extraBedrooms * DURATION_ROOM_ADJUSTMENT_MINUTES.additionalBedroom +
    extraFullBaths * DURATION_ROOM_ADJUSTMENT_MINUTES.additionalFullBathroom +
    extraHalfBaths * DURATION_ROOM_ADJUSTMENT_MINUTES.additionalHalfBathroom;

  // Every reachable (cleaningType, condition) pair has a configured
  // multiplier except Standard+Extensive, which the pricing engine itself
  // never allows through to this point (manual review instead) — the ?? 1
  // fallback is defensive only, matching calculate-estimate.ts's own
  // defensive-guard precedent for an unconfigured multiplier.
  const conditionMultiplier = CONDITION_MULTIPLIERS[input.cleaningType][input.condition] ?? 1;

  const estimatedLaborMinutes = Math.round((baseMinutes + roomAdjustmentMinutes) * conditionMultiplier);

  const recommendedCleanerCount = RECOMMENDED_CLEANER_COUNT[input.sizeTier];

  const estimatedServiceMinutes = roundUpToIncrement(
    Math.ceil(estimatedLaborMinutes / recommendedCleanerCount),
    SERVICE_MINUTES_ROUNDING_INCREMENT
  );

  return { estimatedLaborMinutes, recommendedCleanerCount, estimatedServiceMinutes };
}
