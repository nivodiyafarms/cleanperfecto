import type { OutdoorSelection } from "@/lib/pricing/types";
import type { AddOnSelection } from "@/components/quote-wizard/map-form-to-raw-input";
import {
  KNOWN_ADD_ON_IDS,
  KNOWN_SPECIAL_ROOM_IDS,
  validateMovePackageLevel,
  validateOutdoorSelection,
  validateQuantifiedAddOns,
} from "./validate-customization-selection";

/**
 * URL query-string encoding for the post-estimate customization selection
 * carried from QuoteWizard's "Continue to Booking" link into the booking
 * page (see QuoteBookingPage). Every field is parsed here into plain JS
 * values and then run through the same field-level validators the
 * createNormalBookingCheckout server action uses (validate-customization-
 * selection.ts) — an unknown/malformed value for one field is dropped in
 * isolation, falling back to the same "not selected" default a
 * pre-existing link (with no rich customization params at all) would
 * already produce, never trusted verbatim.
 */

export interface CustomizationSelectionSearchParams {
  addOns?: string | string[];
  specialRooms?: string | string[];
  movePackageLevel?: string | string[];
  outdoor?: string | string[];
  windows?: string | string[];
}

function firstValue(raw: string | string[] | undefined): string | undefined {
  return Array.isArray(raw) ? raw[0] : raw;
}

function parseIdList<T extends string>(raw: string | string[] | undefined, known: Set<T>): T[] {
  const value = firstValue(raw);
  if (!value) return [];
  return value
    .split(",")
    .map((id) => id.trim())
    .filter((id): id is T => known.has(id as T));
}

function parseJson(raw: string | string[] | undefined): unknown {
  const value = firstValue(raw);
  if (!value) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

/**
 * Server-side parse — the trust boundary. Any field that is missing,
 * unrecognized, or structurally malformed silently falls back to the same
 * "nothing selected" default a pre-existing/old booking link (with no rich
 * customization params at all) would already produce, rather than being
 * rejected outright or trusted as-is.
 */
export function parseCustomizationSelectionParams(
  searchParams: CustomizationSelectionSearchParams
): AddOnSelection {
  return {
    addOnIds: parseIdList(searchParams.addOns, KNOWN_ADD_ON_IDS),
    specialRooms: parseIdList(searchParams.specialRooms, KNOWN_SPECIAL_ROOM_IDS),
    movePackageLevel: validateMovePackageLevel(firstValue(searchParams.movePackageLevel)),
    outdoorSelection: validateOutdoorSelection(parseJson(searchParams.outdoor)),
    quantifiedAddOns: validateQuantifiedAddOns(parseJson(searchParams.windows)),
  };
}

/**
 * Deterministic encoding for the "Continue to Booking" link — the same
 * selection always produces the same query string (stable key order in
 * every JSON-encoded field, ids joined in their existing array order).
 * Fields that are empty/absent are omitted entirely so a plain, no-extras
 * selection produces exactly the same URL shape as before this feature
 * existed (backward-compatible with any previously-shared link).
 */
export function encodeCustomizationSelectionParams(selection: AddOnSelection): URLSearchParams {
  const params = new URLSearchParams();

  if (selection.addOnIds.length > 0) {
    params.set("addOns", selection.addOnIds.join(","));
  }
  if (selection.specialRooms && selection.specialRooms.length > 0) {
    params.set("specialRooms", selection.specialRooms.join(","));
  }
  if (selection.movePackageLevel) {
    params.set("movePackageLevel", selection.movePackageLevel);
  }
  if (selection.outdoorSelection && Object.keys(selection.outdoorSelection).length > 0) {
    const outdoor = selection.outdoorSelection;
    const ordered: OutdoorSelection = {};
    if (outdoor.porchSqFt !== undefined) ordered.porchSqFt = outdoor.porchSqFt;
    if (outdoor.patioSqFt !== undefined) ordered.patioSqFt = outdoor.patioSqFt;
    if (outdoor.garageCars !== undefined) ordered.garageCars = outdoor.garageCars;
    if (outdoor.trio !== undefined) ordered.trio = outdoor.trio;
    if (outdoor.oilDegreaseAffectedBays !== undefined) ordered.oilDegreaseAffectedBays = outdoor.oilDegreaseAffectedBays;
    if (outdoor.algaeMildewTreatmentSize !== undefined) ordered.algaeMildewTreatmentSize = outdoor.algaeMildewTreatmentSize;
    params.set("outdoor", JSON.stringify(ordered));
  }
  if (selection.quantifiedAddOns && selection.quantifiedAddOns.length > 0) {
    const ordered = selection.quantifiedAddOns.map(({ id, quantity }) => ({ id, quantity }));
    params.set("windows", JSON.stringify(ordered));
  }

  return params;
}
