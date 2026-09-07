import { ADD_ON_CATALOG, QUANTIFIED_ADD_ON_CATALOG } from "@/lib/pricing/add-ons";
import type {
  AddOnId,
  AlgaeMildewTreatmentSize,
  MovePackageLevel,
  OutdoorSelection,
  QuantifiedAddOnId,
  QuantifiedAddOnSelection,
  SpecialRoomId,
  TrioSize,
} from "@/lib/pricing/types";

/**
 * Shared field-level validators for the post-estimate customization
 * selection, used at every point it crosses a trust boundary: the booking
 * page's URL query string (see customization-selection-params.ts) AND the
 * createNormalBookingCheckout server action, which is directly callable
 * with arbitrary JSON regardless of what the TypeScript client believes it
 * is sending. Every validator drops an unknown/malformed value rather than
 * trusting it or rejecting the whole request — the same "not selected"
 * default a plain request with no customization at all would produce.
 */

export const KNOWN_ADD_ON_IDS = new Set(Object.keys(ADD_ON_CATALOG) as AddOnId[]);
export const KNOWN_SPECIAL_ROOM_IDS = new Set<SpecialRoomId>(["game_room", "media_room"]);
export const KNOWN_MOVE_PACKAGE_LEVELS = new Set<MovePackageLevel>(["basic", "complete"]);
const KNOWN_TRIO_SIZES = new Set<TrioSize>(["small", "medium", "large"]);
const KNOWN_ALGAE_MILDEW_SIZES = new Set<AlgaeMildewTreatmentSize>(["small", "medium", "large"]);
export const KNOWN_QUANTIFIED_ADD_ON_IDS = new Set(Object.keys(QUANTIFIED_ADD_ON_CATALOG) as QuantifiedAddOnId[]);

/** Generous but finite — guards against absurd/abusive values; the pricing engine's own config bands are the real authority on what's actually priceable. */
const MAX_OUTDOOR_DIMENSION = 100_000;
const MAX_QUANTIFIED_QUANTITY = 1_000;

export function validateAddOnIds(raw: unknown): AddOnId[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((id): id is AddOnId => typeof id === "string" && KNOWN_ADD_ON_IDS.has(id as AddOnId));
}

export function validateSpecialRooms(raw: unknown): SpecialRoomId[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((id): id is SpecialRoomId => typeof id === "string" && KNOWN_SPECIAL_ROOM_IDS.has(id as SpecialRoomId));
}

export function validateMovePackageLevel(raw: unknown): MovePackageLevel | undefined {
  return typeof raw === "string" && KNOWN_MOVE_PACKAGE_LEVELS.has(raw as MovePackageLevel)
    ? (raw as MovePackageLevel)
    : undefined;
}

function isFiniteNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= MAX_OUTDOOR_DIMENSION;
}

export function validateOutdoorSelection(raw: unknown): OutdoorSelection | undefined {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return undefined;
  const candidate = raw as Record<string, unknown>;

  const result: OutdoorSelection = {};
  if (isFiniteNonNegativeNumber(candidate.porchSqFt)) result.porchSqFt = candidate.porchSqFt;
  if (isFiniteNonNegativeNumber(candidate.patioSqFt)) result.patioSqFt = candidate.patioSqFt;
  if (isFiniteNonNegativeNumber(candidate.garageCars)) result.garageCars = candidate.garageCars;
  if (isFiniteNonNegativeNumber(candidate.oilDegreaseAffectedBays)) {
    result.oilDegreaseAffectedBays = candidate.oilDegreaseAffectedBays;
  }
  if (typeof candidate.trio === "string" && KNOWN_TRIO_SIZES.has(candidate.trio as TrioSize)) {
    result.trio = candidate.trio as TrioSize;
  }
  if (
    typeof candidate.algaeMildewTreatmentSize === "string" &&
    KNOWN_ALGAE_MILDEW_SIZES.has(candidate.algaeMildewTreatmentSize as AlgaeMildewTreatmentSize)
  ) {
    result.algaeMildewTreatmentSize = candidate.algaeMildewTreatmentSize as AlgaeMildewTreatmentSize;
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

export function validateQuantifiedAddOns(raw: unknown): QuantifiedAddOnSelection[] | undefined {
  if (!Array.isArray(raw)) return undefined;

  const result: QuantifiedAddOnSelection[] = [];
  const seen = new Set<QuantifiedAddOnId>();
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const { id, quantity } = entry as Record<string, unknown>;
    if (typeof id !== "string" || !KNOWN_QUANTIFIED_ADD_ON_IDS.has(id as QuantifiedAddOnId)) continue;
    if (seen.has(id as QuantifiedAddOnId)) continue;
    if (typeof quantity !== "number" || !Number.isInteger(quantity) || quantity <= 0 || quantity > MAX_QUANTIFIED_QUANTITY) {
      continue;
    }
    seen.add(id as QuantifiedAddOnId);
    result.push({ id: id as QuantifiedAddOnId, quantity });
  }

  return result.length > 0 ? result : undefined;
}
