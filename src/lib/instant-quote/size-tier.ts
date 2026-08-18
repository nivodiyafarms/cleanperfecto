import type { SizeTier } from "@/lib/pricing/types";

/**
 * Maps a raw bedroom count to the pricing engine's SizeTier, per CLAUDE.md's
 * "Approved Starting Prices" categories — bedroom count alone drives the
 * tier; extra bathrooms beyond a tier's baseline are priced as a room
 * adjustment (see src/lib/pricing/room-adjustments.ts), never a tier bump.
 * This mirrors src/lib/pricing/config.ts's SIZE_TIER_BASELINE_ROOMS bedroom
 * column exactly, without importing/modifying that pricing module.
 */
export function resolveSizeTier(bedrooms: number): SizeTier {
  if (bedrooms <= 0) return "studio_1ba";
  if (bedrooms === 1) return "1br_1ba";
  if (bedrooms === 2) return "2br_2ba";
  if (bedrooms === 3) return "3br_2ba";
  return "4br_plus";
}
