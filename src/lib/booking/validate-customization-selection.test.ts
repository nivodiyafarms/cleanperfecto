import { describe, expect, it } from "vitest";
import {
  validateAddOnIds,
  validateMovePackageLevel,
  validateOutdoorSelection,
  validateQuantifiedAddOns,
  validateSpecialRooms,
} from "./validate-customization-selection";

// These validators are the trust boundary for createNormalBookingCheckout —
// a "use server" action callable with arbitrary JSON regardless of what the
// TypeScript client believes it's sending, so every case here simulates a
// caller that ignores the declared NormalBookingSelectionInput type.

describe("validateAddOnIds", () => {
  it("passes through known add-on ids", () => {
    expect(validateAddOnIds(["inside_oven", "inside_refrigerator"])).toEqual(["inside_oven", "inside_refrigerator"]);
  });

  it("drops unknown ids while keeping known ones", () => {
    expect(validateAddOnIds(["inside_oven", "totally_fake_addon"])).toEqual(["inside_oven"]);
  });

  it("returns [] for a non-array value (e.g. a malicious string/object/number payload)", () => {
    expect(validateAddOnIds("inside_oven")).toEqual([]);
    expect(validateAddOnIds({ id: "inside_oven" })).toEqual([]);
    expect(validateAddOnIds(42)).toEqual([]);
    expect(validateAddOnIds(null)).toEqual([]);
    expect(validateAddOnIds(undefined)).toEqual([]);
  });

  it("drops non-string entries inside an otherwise-valid array", () => {
    expect(validateAddOnIds(["inside_oven", 123, null, {}])).toEqual(["inside_oven"]);
  });
});

describe("validateSpecialRooms", () => {
  it("passes through known ids and drops unknown ones", () => {
    expect(validateSpecialRooms(["game_room", "media_room", "sauna_room"])).toEqual(["game_room", "media_room"]);
  });

  it("returns [] for a non-array value", () => {
    expect(validateSpecialRooms("game_room")).toEqual([]);
  });
});

describe("validateMovePackageLevel", () => {
  it("accepts 'basic' and 'complete'", () => {
    expect(validateMovePackageLevel("basic")).toBe("basic");
    expect(validateMovePackageLevel("complete")).toBe("complete");
  });

  it("falls back to undefined for anything else", () => {
    expect(validateMovePackageLevel("deluxe")).toBeUndefined();
    expect(validateMovePackageLevel(1)).toBeUndefined();
    expect(validateMovePackageLevel(null)).toBeUndefined();
    expect(validateMovePackageLevel(undefined)).toBeUndefined();
  });
});

describe("validateOutdoorSelection", () => {
  it("accepts a fully-populated valid object", () => {
    expect(
      validateOutdoorSelection({
        porchSqFt: 150,
        patioSqFt: 300,
        garageCars: 2,
        trio: "medium",
        oilDegreaseAffectedBays: 1,
        algaeMildewTreatmentSize: "small",
      })
    ).toEqual({
      porchSqFt: 150,
      patioSqFt: 300,
      garageCars: 2,
      trio: "medium",
      oilDegreaseAffectedBays: 1,
      algaeMildewTreatmentSize: "small",
    });
  });

  it("drops individual invalid fields but keeps the valid ones", () => {
    expect(validateOutdoorSelection({ porchSqFt: -5, garageCars: 2, trio: "enormous" })).toEqual({ garageCars: 2 });
  });

  it("rejects negative numbers, NaN, Infinity, and absurdly large values per field", () => {
    expect(validateOutdoorSelection({ porchSqFt: -1 })).toBeUndefined();
    expect(validateOutdoorSelection({ porchSqFt: Number.NaN })).toBeUndefined();
    expect(validateOutdoorSelection({ porchSqFt: Number.POSITIVE_INFINITY })).toBeUndefined();
    expect(validateOutdoorSelection({ porchSqFt: 10_000_000 })).toBeUndefined();
  });

  it("returns undefined for null, an array, or a non-object", () => {
    expect(validateOutdoorSelection(null)).toBeUndefined();
    expect(validateOutdoorSelection(["small"])).toBeUndefined();
    expect(validateOutdoorSelection("small")).toBeUndefined();
  });

  it("returns undefined for an object with no recognized fields at all", () => {
    expect(validateOutdoorSelection({ notARealField: 123 })).toBeUndefined();
  });
});

describe("validateQuantifiedAddOns", () => {
  it("accepts a valid array of known ids with positive integer quantities", () => {
    expect(
      validateQuantifiedAddOns([
        { id: "interior_window_detailing", quantity: 3 },
        { id: "exterior_window_cleaning", quantity: 1 },
      ])
    ).toEqual([
      { id: "interior_window_detailing", quantity: 3 },
      { id: "exterior_window_cleaning", quantity: 1 },
    ]);
  });

  it("drops entries with an unknown id, non-integer quantity, zero, or negative quantity", () => {
    expect(
      validateQuantifiedAddOns([
        { id: "not_real", quantity: 2 },
        { id: "interior_window_detailing", quantity: 2.5 },
        { id: "interior_window_detailing", quantity: 0 },
        { id: "interior_window_detailing", quantity: -3 },
      ])
    ).toBeUndefined();
  });

  it("de-duplicates by id, keeping only the first occurrence", () => {
    expect(
      validateQuantifiedAddOns([
        { id: "interior_window_detailing", quantity: 2 },
        { id: "interior_window_detailing", quantity: 9 },
      ])
    ).toEqual([{ id: "interior_window_detailing", quantity: 2 }]);
  });

  it("returns undefined for a non-array value", () => {
    expect(validateQuantifiedAddOns({ id: "interior_window_detailing", quantity: 2 })).toBeUndefined();
    expect(validateQuantifiedAddOns(null)).toBeUndefined();
  });
});
