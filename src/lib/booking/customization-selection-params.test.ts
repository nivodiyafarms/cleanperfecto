import { describe, expect, it } from "vitest";
import { buildBookingPricingOptions } from "./build-booking-pricing-options";
import {
  encodeCustomizationSelectionParams,
  parseCustomizationSelectionParams,
} from "./customization-selection-params";
import type { AddOnSelection } from "@/components/quote-wizard/map-form-to-raw-input";
import type { CalculationInput } from "@/lib/pricing/types";

// Uses the REAL production pricing config (no overrides), same convention
// as build-booking-pricing-options.test.ts.
function baseInput(overrides: Partial<CalculationInput> = {}): CalculationInput {
  return {
    propertyKind: "home",
    cleaningType: "standard",
    condition: "light",
    sizeTier: "2br_2ba",
    zip: "75056",
    frequency: "one_time",
    isPrepaidPackage: false,
    visitCount: 1,
    addOnIds: [],
    firstCleaningEligible: false,
    asOf: new Date("2026-09-15T12:00:00-05:00"),
    ...overrides,
  };
}

/** A representative "rich" selection exercising every customization field at once. */
const RICH_SELECTION: AddOnSelection = {
  addOnIds: ["inside_oven", "inside_refrigerator", "inside_cabinets_drawers"],
  specialRooms: ["game_room", "media_room"],
  movePackageLevel: undefined,
  outdoorSelection: { trio: "small" },
  quantifiedAddOns: [{ id: "interior_window_detailing", quantity: 3 }],
};

describe("customization selection URL round-trip", () => {
  it("encodes and parses a representative rich selection back to the exact same values", () => {
    const params = encodeCustomizationSelectionParams(RICH_SELECTION);
    const parsed = parseCustomizationSelectionParams(Object.fromEntries(params.entries()));

    expect(parsed.addOnIds).toEqual(RICH_SELECTION.addOnIds);
    expect(parsed.specialRooms).toEqual(RICH_SELECTION.specialRooms);
    expect(parsed.movePackageLevel).toBeUndefined();
    expect(parsed.outdoorSelection).toEqual(RICH_SELECTION.outdoorSelection);
    expect(parsed.quantifiedAddOns).toEqual(RICH_SELECTION.quantifiedAddOns);
  });

  it("round-trips a Move-In/Move-Out selection including movePackageLevel", () => {
    const selection: AddOnSelection = {
      addOnIds: [],
      movePackageLevel: "complete",
    };
    const params = encodeCustomizationSelectionParams(selection);
    const parsed = parseCustomizationSelectionParams(Object.fromEntries(params.entries()));
    expect(parsed.movePackageLevel).toBe("complete");
  });

  it("produces no query params at all for an empty selection — identical URL shape to before this feature existed", () => {
    const params = encodeCustomizationSelectionParams({ addOnIds: [] });
    expect(params.toString()).toBe("");
  });

  it("an old-style link with only ?addOns= still parses correctly, with safe defaults for every new field", () => {
    const parsed = parseCustomizationSelectionParams({ addOns: "inside_oven,inside_refrigerator" });
    expect(parsed.addOnIds).toEqual(["inside_oven", "inside_refrigerator"]);
    expect(parsed.specialRooms).toEqual([]);
    expect(parsed.movePackageLevel).toBeUndefined();
    expect(parsed.outdoorSelection).toBeUndefined();
    expect(parsed.quantifiedAddOns).toBeUndefined();
  });

  it("a request with no customization params at all parses to the same empty defaults", () => {
    const parsed = parseCustomizationSelectionParams({});
    expect(parsed).toEqual({
      addOnIds: [],
      specialRooms: [],
      movePackageLevel: undefined,
      outdoorSelection: undefined,
      quantifiedAddOns: undefined,
    });
  });

  describe("malformed/unsupported values are dropped, never trusted", () => {
    it("drops an unknown addOnId while keeping the known ones", () => {
      const parsed = parseCustomizationSelectionParams({ addOns: "inside_oven,not_a_real_addon" });
      expect(parsed.addOnIds).toEqual(["inside_oven"]);
    });

    it("drops an unknown specialRoom id", () => {
      const parsed = parseCustomizationSelectionParams({ specialRooms: "game_room,sauna_room" });
      expect(parsed.specialRooms).toEqual(["game_room"]);
    });

    it("falls back to undefined for an invalid movePackageLevel value", () => {
      const parsed = parseCustomizationSelectionParams({ movePackageLevel: "deluxe" });
      expect(parsed.movePackageLevel).toBeUndefined();
    });

    it("falls back to undefined for non-JSON outdoor/windows params instead of throwing", () => {
      const parsed = parseCustomizationSelectionParams({ outdoor: "{not json", windows: "[also not json" });
      expect(parsed.outdoorSelection).toBeUndefined();
      expect(parsed.quantifiedAddOns).toBeUndefined();
    });

    it("drops individual invalid fields inside an otherwise-valid outdoor JSON object", () => {
      const parsed = parseCustomizationSelectionParams({
        outdoor: JSON.stringify({ trio: "gigantic", porchSqFt: -50, garageCars: 2 }),
      });
      expect(parsed.outdoorSelection).toEqual({ garageCars: 2 });
    });

    it("drops a quantifiedAddOns entry with a non-integer or non-positive quantity", () => {
      const parsed = parseCustomizationSelectionParams({
        windows: JSON.stringify([
          { id: "interior_window_detailing", quantity: 2.5 },
          { id: "exterior_window_cleaning", quantity: -1 },
          { id: "interior_window_detailing", quantity: 0 },
        ]),
      });
      expect(parsed.quantifiedAddOns).toBeUndefined();
    });

    it("drops a quantifiedAddOns entry with an unknown id", () => {
      const parsed = parseCustomizationSelectionParams({
        windows: JSON.stringify([{ id: "not_a_real_window_service", quantity: 2 }]),
      });
      expect(parsed.quantifiedAddOns).toBeUndefined();
    });

    it("an outdoor value that is an array (not an object) is rejected entirely", () => {
      const parsed = parseCustomizationSelectionParams({ outdoor: JSON.stringify(["small"]) });
      expect(parsed.outdoorSelection).toBeUndefined();
    });
  });
});

describe("end-to-end: rich customization survives QuoteWizard -> booking handoff -> booking calculation unchanged", () => {
  it("computes an identical CalculationResult whether the rich selection is used directly or round-tripped through the URL first", () => {
    const asOf = new Date("2026-09-15T12:00:00-05:00");

    const directOptions = buildBookingPricingOptions({
      baseInput: baseInput(),
      firstCleaningEligible: false,
      addOnIds: RICH_SELECTION.addOnIds,
      specialRooms: RICH_SELECTION.specialRooms,
      movePackageLevel: RICH_SELECTION.movePackageLevel,
      outdoorSelection: RICH_SELECTION.outdoorSelection,
      quantifiedAddOns: RICH_SELECTION.quantifiedAddOns,
      asOf,
    });

    // Simulate the actual handoff: QuoteWizard encodes the selection into a
    // URL, the booking page decodes it back from raw query-string values.
    const params = encodeCustomizationSelectionParams(RICH_SELECTION);
    const roundTripped = parseCustomizationSelectionParams(Object.fromEntries(params.entries()));

    const roundTrippedOptions = buildBookingPricingOptions({
      baseInput: baseInput(),
      firstCleaningEligible: false,
      addOnIds: roundTripped.addOnIds,
      specialRooms: roundTripped.specialRooms,
      movePackageLevel: roundTripped.movePackageLevel,
      outdoorSelection: roundTripped.outdoorSelection,
      quantifiedAddOns: roundTripped.quantifiedAddOns,
      asOf,
    });

    expect(roundTrippedOptions).toEqual(directOptions);

    // And prove the rich selection actually changed the price relative to a
    // no-extras baseline — otherwise this test would pass even if every
    // rich field were silently discarded somewhere along the handoff.
    const emptyOptions = buildBookingPricingOptions({
      baseInput: baseInput(),
      firstCleaningEligible: false,
      addOnIds: [],
      asOf,
    });
    expect(roundTrippedOptions.normal.one_time.calculatedTotal).toBeGreaterThan(
      emptyOptions.normal.one_time.calculatedTotal
    );
    expect(roundTrippedOptions.normal.one_time.specialRoomCharges.length).toBe(2);
    expect(roundTrippedOptions.normal.one_time.quantifiedAddOns.length).toBe(1);
    expect(roundTrippedOptions.normal.one_time.outdoorCharges.length).toBeGreaterThan(0);
  });

  it("a Move-In/Move-Out movePackageLevel selection survives the same round trip unchanged", () => {
    const asOf = new Date("2026-09-15T12:00:00-05:00");
    const moveBase = baseInput({ cleaningType: "move" });
    const selection: AddOnSelection = { addOnIds: [], movePackageLevel: "complete" };

    const directOptions = buildBookingPricingOptions({
      baseInput: moveBase,
      firstCleaningEligible: false,
      addOnIds: selection.addOnIds,
      movePackageLevel: selection.movePackageLevel,
      asOf,
    });

    const params = encodeCustomizationSelectionParams(selection);
    const roundTripped = parseCustomizationSelectionParams(Object.fromEntries(params.entries()));
    const roundTrippedOptions = buildBookingPricingOptions({
      baseInput: moveBase,
      firstCleaningEligible: false,
      addOnIds: roundTripped.addOnIds,
      movePackageLevel: roundTripped.movePackageLevel,
      asOf,
    });

    expect(roundTrippedOptions).toEqual(directOptions);
    expect(roundTrippedOptions.normal.one_time.movePackageLevel).toBe("complete");
  });

  it("an old-style addOns-only link still produces the correct priced result through the same pipeline", () => {
    const asOf = new Date("2026-09-15T12:00:00-05:00");
    const parsed = parseCustomizationSelectionParams({ addOns: "inside_oven" });

    const options = buildBookingPricingOptions({
      baseInput: baseInput(),
      firstCleaningEligible: false,
      addOnIds: parsed.addOnIds,
      specialRooms: parsed.specialRooms,
      movePackageLevel: parsed.movePackageLevel,
      outdoorSelection: parsed.outdoorSelection,
      quantifiedAddOns: parsed.quantifiedAddOns,
      asOf,
    });

    expect(options.normal.one_time.pricedAddOns).toEqual([
      expect.objectContaining({ id: "inside_oven", amount: 30, pricingKind: "fixed" }),
    ]);
  });
});
