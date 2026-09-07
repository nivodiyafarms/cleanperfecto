import { describe, expect, it } from "vitest";
import { calculateEstimate } from "./calculate-estimate";
import type { SuppliesEquipmentRule } from "./supplies-equipment";
import type { AddOnId, CalculationInput, CleaningType } from "./types";
import type { ZipTravelRule } from "./zip-travel";

// ---------------------------------------------------------------------------
// Isolated test fixtures — same pattern as calculate-estimate.test.ts, kept
// independent of production config so these tests stay deterministic.
// ---------------------------------------------------------------------------

const TEST_ZIP_NO_TRAVEL: ZipTravelRule[] = [{ zip: "99999", percentage: 0, band: "core" }];

const ALL_CLEANING_TYPES: CleaningType[] = ["standard", "deep", "move"];
const TEST_SUPPLIES_CONFIG: SuppliesEquipmentRule[] = ALL_CLEANING_TYPES.map((cleaningType) => ({
  cleaningType,
  minSqFt: 0,
  maxSqFt: 100000,
  amount: 15,
}));

const TEST_OVERRIDES = {
  zipTravelConfig: TEST_ZIP_NO_TRAVEL,
  suppliesEquipmentConfig: TEST_SUPPLIES_CONFIG,
};

function baseInput(overrides: Partial<CalculationInput> = {}): CalculationInput {
  return {
    propertyKind: "home",
    cleaningType: "standard",
    condition: "light",
    sizeTier: "1br_1ba",
    zip: "99999",
    frequency: "one_time",
    isPrepaidPackage: false,
    visitCount: 1,
    addOnIds: [],
    firstCleaningEligible: false,
    asOf: new Date("2026-06-01T12:00:00-05:00"),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. Standard < Deep for an equivalent property
// ---------------------------------------------------------------------------

describe("service hierarchy: Standard < Deep", () => {
  it("Deep costs more than Standard for the same property/condition", () => {
    const standard = calculateEstimate(baseInput({ cleaningType: "standard" }), TEST_OVERRIDES);
    const deep = calculateEstimate(baseInput({ cleaningType: "deep" }), TEST_OVERRIDES);
    expect(standard.calculatedTotal).toBeLessThan(deep.calculatedTotal);
  });
});

// ---------------------------------------------------------------------------
// 2 & 3. Basic Move-In/Out >= equivalent Deep, including after discounts
// ---------------------------------------------------------------------------

describe("Move-In/Move-Out floor: Basic >= equivalent Deep", () => {
  it("raises Basic Move above its own raw total to match equivalent Deep when Move's own base would otherwise be lower (4+ bedroom tier)", () => {
    const deep = calculateEstimate(baseInput({ cleaningType: "deep", sizeTier: "4br_plus" }), TEST_OVERRIDES);
    const move = calculateEstimate(baseInput({ cleaningType: "move", sizeTier: "4br_plus" }), TEST_OVERRIDES);
    expect(move.calculatedTotal).toBeGreaterThanOrEqual(deep.calculatedTotal);
    expect(move.moveFloorApplied).toBe(true);
    expect(move.moveEquivalentDeepTotal).toBe(deep.calculatedTotal);
  });

  it("does not need the floor when Move's own total already exceeds equivalent Deep (studio tier)", () => {
    const deep = calculateEstimate(baseInput({ cleaningType: "deep", sizeTier: "studio_1ba" }), TEST_OVERRIDES);
    const move = calculateEstimate(baseInput({ cleaningType: "move", sizeTier: "studio_1ba" }), TEST_OVERRIDES);
    expect(move.calculatedTotal).toBeGreaterThanOrEqual(deep.calculatedTotal);
    expect(move.moveFloorApplied).toBe(false);
  });

  it("preserves the hierarchy through the final pre-tax result even after a first-cleaning discount is applied to both", () => {
    const deep = calculateEstimate(
      baseInput({
        cleaningType: "deep",
        sizeTier: "4br_plus",
        firstCleaningEligible: true,
        asOf: new Date("2026-08-15T12:00:00-05:00"),
      }),
      TEST_OVERRIDES
    );
    const move = calculateEstimate(
      baseInput({
        cleaningType: "move",
        sizeTier: "4br_plus",
        firstCleaningEligible: true,
        asOf: new Date("2026-08-15T12:00:00-05:00"),
      }),
      TEST_OVERRIDES
    );
    expect(move.calculatedTotal).toBeGreaterThanOrEqual(deep.calculatedTotal);
  });

  it("holds for a recurring 6+ prepaid package on both sides too", () => {
    const deep = calculateEstimate(
      baseInput({
        cleaningType: "deep",
        sizeTier: "4br_plus",
        frequency: "weekly",
        isPrepaidPackage: true,
        visitCount: 6,
      }),
      TEST_OVERRIDES
    );
    const move = calculateEstimate(
      baseInput({
        cleaningType: "move",
        sizeTier: "4br_plus",
        frequency: "weekly",
        isPrepaidPackage: true,
        visitCount: 6,
      }),
      TEST_OVERRIDES
    );
    expect(move.calculatedTotal).toBeGreaterThanOrEqual(deep.calculatedTotal);
  });

  it("the equivalent-Deep comparison excludes add-ons on both sides", () => {
    const move = calculateEstimate(
      baseInput({ cleaningType: "move", sizeTier: "4br_plus", addOnIds: ["inside_oven"] }),
      TEST_OVERRIDES
    );
    const moveWithoutAddOn = calculateEstimate(
      baseInput({ cleaningType: "move", sizeTier: "4br_plus" }),
      TEST_OVERRIDES
    );
    expect(move.moveEquivalentDeepTotal).toBe(moveWithoutAddOn.moveEquivalentDeepTotal);
  });
});

// ---------------------------------------------------------------------------
// 39. Estimate range remains compatible with the Move >= Deep hierarchy
// ---------------------------------------------------------------------------

describe("estimate range hierarchy consistency", () => {
  it("Basic Move's range never displays below equivalent Deep's range once the floor applies", () => {
    const deep = calculateEstimate(baseInput({ cleaningType: "deep", sizeTier: "4br_plus" }), TEST_OVERRIDES);
    const move = calculateEstimate(baseInput({ cleaningType: "move", sizeTier: "4br_plus" }), TEST_OVERRIDES);
    expect(move.moveFloorApplied).toBe(true);
    expect(move.range!.lower).toBeGreaterThanOrEqual(deep.range!.lower);
    expect(move.range!.upper).toBeGreaterThanOrEqual(deep.range!.upper);
  });
});

// ---------------------------------------------------------------------------
// 4-12. Complete = Basic + square-footage upgrade, including boundaries
// ---------------------------------------------------------------------------

describe("Move-In/Move-Out Complete package upgrade", () => {
  it("Complete = Basic + the square-footage-banded upgrade", () => {
    const basic = calculateEstimate(
      baseInput({ cleaningType: "move", movePackageLevel: "basic", squareFeet: 1300 }),
      TEST_OVERRIDES
    );
    const complete = calculateEstimate(
      baseInput({ cleaningType: "move", movePackageLevel: "complete", squareFeet: 1300 }),
      TEST_OVERRIDES
    );
    expect(complete.moveCompleteUpgrade).toBe(50);
    expect(complete.calculatedTotal).toBeCloseTo(basic.calculatedTotal + 50);
  });

  it.each([
    { sqFt: 1500, expectedUpgrade: 50 },
    { sqFt: 1501, expectedUpgrade: 65 },
    { sqFt: 2500, expectedUpgrade: 65 },
    { sqFt: 2501, expectedUpgrade: 80 },
    { sqFt: 3500, expectedUpgrade: 80 },
    { sqFt: 3501, expectedUpgrade: 100 },
    { sqFt: 4500, expectedUpgrade: 100 },
  ])("$sqFt sq ft applies a +$$expectedUpgrade Complete upgrade", ({ sqFt, expectedUpgrade }) => {
    const result = calculateEstimate(
      baseInput({ cleaningType: "move", movePackageLevel: "complete", squareFeet: sqFt }),
      TEST_OVERRIDES
    );
    expect(result.moveCompleteUpgrade).toBe(expectedUpgrade);
    expect(result.moveCompleteUpgradeConfigured).toBe(true);
  });

  it("beyond 4,500 sq ft, Complete requires a custom quote WITHOUT destroying the valid Basic calculation", () => {
    // Widen the general square-footage ceiling in isolation so this test
    // exercises ONLY the Complete-upgrade-specific gap — in production the
    // two ceilings coincide at 4,500 sq ft for the largest tier, so a
    // request this large is already fully manual for an unrelated, more
    // basic reason (see the "manual/custom propagation" test below for
    // that real end-to-end case).
    const widenedSquareFootageConfig = [
      { sizeTier: "4br_plus" as const, includedSqFt: 3000, additionalBandSqFt: 500, multiplierPerBand: 0.05, maxConfiguredSqFt: 10000 },
    ];
    const overridesWithWiderSqft = { ...TEST_OVERRIDES, squareFootageConfig: widenedSquareFootageConfig };
    const result = calculateEstimate(
      baseInput({ cleaningType: "move", sizeTier: "4br_plus", movePackageLevel: "complete", squareFeet: 4501 }),
      overridesWithWiderSqft
    );
    const basic = calculateEstimate(
      baseInput({ cleaningType: "move", sizeTier: "4br_plus", movePackageLevel: "basic", squareFeet: 4501 }),
      overridesWithWiderSqft
    );
    expect(result.moveCompleteUpgradeConfigured).toBe(false);
    expect(result.manualReviewReasons).toContain("MOVE_COMPLETE_UPGRADE_NOT_CONFIGURED");
    // Basic remains fully calculable and is what's actually returned — never a misleading Complete total.
    expect(result.calculatedTotal).toBeCloseTo(basic.calculatedTotal);
    expect(result.estimateType).toBe("instant-range");
    expect(result.manualReviewRequired).toBe(true);
    expect(result.range).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 13-18. Game Room / Media-Theater Room
// ---------------------------------------------------------------------------

describe("Game Room / Media-Theater Room", () => {
  it.each([
    { cleaningType: "standard" as const, expected: 15 },
    { cleaningType: "deep" as const, expected: 20 },
    { cleaningType: "move" as const, expected: 20 },
  ])("Game Room on $cleaningType adds +$$expected to the cleaning subtotal", ({ cleaningType, expected }) => {
    const without = calculateEstimate(baseInput({ cleaningType }), TEST_OVERRIDES);
    const withGameRoom = calculateEstimate(baseInput({ cleaningType, specialRooms: ["game_room"] }), TEST_OVERRIDES);
    expect(withGameRoom.cleaningSubtotal - without.cleaningSubtotal).toBeCloseTo(expected);
    expect(withGameRoom.specialRoomCharges).toEqual([{ id: "game_room", label: "Game Room", amount: expected }]);
  });

  it.each([
    { cleaningType: "standard" as const, expected: 15 },
    { cleaningType: "deep" as const, expected: 20 },
    { cleaningType: "move" as const, expected: 20 },
  ])("Media/Theater Room on $cleaningType adds +$$expected to the cleaning subtotal", ({ cleaningType, expected }) => {
    const without = calculateEstimate(baseInput({ cleaningType }), TEST_OVERRIDES);
    const withMediaRoom = calculateEstimate(baseInput({ cleaningType, specialRooms: ["media_room"] }), TEST_OVERRIDES);
    expect(withMediaRoom.cleaningSubtotal - without.cleaningSubtotal).toBeCloseTo(expected);
  });

  it("flows through to the breakdown separately from ordinary bedroom/bathroom room adjustments", () => {
    const result = calculateEstimate(
      baseInput({
        cleaningType: "deep",
        specialRooms: ["game_room", "media_room"],
        rooms: { bedrooms: 2, fullBathrooms: 2, halfBathrooms: 0 },
        sizeTier: "1br_1ba",
      }),
      TEST_OVERRIDES
    );
    // 1br_1ba baseline is 1 bed/1 bath -> +1 bedroom (+$25) and +1 full bath (+$30) Deep, separate from +$40 special rooms.
    expect(result.roomAdjustments).toBe(55);
    expect(result.specialRoomChargesTotal).toBe(40);
  });
});

// ---------------------------------------------------------------------------
// 19-21. Complete package double-charge prevention
// ---------------------------------------------------------------------------

describe("Complete package double-charge prevention", () => {
  it("Complete ignores/prevents duplicate Refrigerator/Oven/Cabinet-Interior charges even under a manipulated request", () => {
    const result = calculateEstimate(
      baseInput({
        cleaningType: "move",
        movePackageLevel: "complete",
        addOnIds: ["inside_refrigerator", "inside_oven", "inside_cabinets_drawers"],
      }),
      TEST_OVERRIDES
    );
    expect(result.pricedAddOnsTotal).toBe(0);
    expect(result.pricedAddOns).toEqual([]);
    expect(result.includedByCompletePackage.map((a) => a.id).sort()).toEqual(
      ["inside_cabinets_drawers", "inside_oven", "inside_refrigerator"].sort()
    );
  });

  it("Basic still charges these three normally (only Complete folds them in)", () => {
    const result = calculateEstimate(
      baseInput({
        cleaningType: "move",
        movePackageLevel: "basic",
        addOnIds: ["inside_refrigerator", "inside_oven"],
      }),
      TEST_OVERRIDES
    );
    expect(result.pricedAddOnsTotal).toBe(65); // $35 + $30
    expect(result.includedByCompletePackage).toEqual([]);
  });

  it("switching Complete -> Basic makes the three add-ons independently chargeable again", () => {
    const complete = calculateEstimate(
      baseInput({ cleaningType: "move", movePackageLevel: "complete", addOnIds: ["inside_oven"] }),
      TEST_OVERRIDES
    );
    const basic = calculateEstimate(
      baseInput({ cleaningType: "move", movePackageLevel: "basic", addOnIds: ["inside_oven"] }),
      TEST_OVERRIDES
    );
    expect(complete.pricedAddOnsTotal).toBe(0);
    expect(basic.pricedAddOnsTotal).toBe(30);
  });

  // -------------------------------------------------------------------
  // Explicit proof: Complete + ANY combination of the folded-in add-ons —
  // including the Refrigerator + Oven Bundle — never increases the
  // Complete price above the no-add-ons Complete baseline.
  // -------------------------------------------------------------------
  const completeBaselineInput = {
    cleaningType: "move" as const,
    movePackageLevel: "complete" as const,
    squareFeet: 1300,
  };

  it.each([
    { label: "Refrigerator Interior alone", addOnIds: ["inside_refrigerator"] },
    { label: "Oven Interior alone", addOnIds: ["inside_oven"] },
    { label: "Inside Cabinets & Drawers alone", addOnIds: ["inside_cabinets_drawers"] },
    { label: "Refrigerator + Oven Bundle alone", addOnIds: ["refrigerator_oven_bundle"] },
    { label: "Refrigerator + Oven (unbundled)", addOnIds: ["inside_refrigerator", "inside_oven"] },
    {
      label: "Refrigerator + Oven + Cabinets",
      addOnIds: ["inside_refrigerator", "inside_oven", "inside_cabinets_drawers"],
    },
    {
      label: "Bundle + Refrigerator + Oven + Cabinets (fully manipulated/redundant request)",
      addOnIds: ["refrigerator_oven_bundle", "inside_refrigerator", "inside_oven", "inside_cabinets_drawers"],
    },
  ] satisfies { label: string; addOnIds: AddOnId[] }[])(
    "Complete + $label never increases the Complete price",
    ({ addOnIds }) => {
      const baseline = calculateEstimate(baseInput(completeBaselineInput), TEST_OVERRIDES);
      const withAddOns = calculateEstimate(baseInput({ ...completeBaselineInput, addOnIds }), TEST_OVERRIDES);
      expect(withAddOns.calculatedTotal).toBe(baseline.calculatedTotal);
      expect(withAddOns.pricedAddOnsTotal).toBe(0);
      expect(withAddOns.preDiscountTotal).toBe(baseline.preDiscountTotal);
    }
  );

  it("the same Bundle+Refrigerator+Oven+Cabinets combination on Basic (not Complete) prices normally, proving the protection is Complete-specific, not a blanket ban", () => {
    const basicWithEverything = calculateEstimate(
      baseInput({
        cleaningType: "move",
        movePackageLevel: "basic",
        squareFeet: 1300,
        addOnIds: ["refrigerator_oven_bundle", "inside_refrigerator", "inside_oven", "inside_cabinets_drawers"],
      }),
      TEST_OVERRIDES
    );
    // Bundle absorbs the standalone Fridge/Oven ($55), plus Cabinets ($40, starting-at) = $95.
    expect(basicWithEverything.pricedAddOnsTotal).toBe(95);
  });
});

// ---------------------------------------------------------------------------
// 22-23. Refrigerator + Oven Bundle
// ---------------------------------------------------------------------------

describe("Refrigerator + Oven Bundle", () => {
  it("prices the bundle at exactly $55", () => {
    const result = calculateEstimate(baseInput({ addOnIds: ["refrigerator_oven_bundle"] }), TEST_OVERRIDES);
    expect(result.pricedAddOnsTotal).toBe(55);
  });

  it("prevents overlapping individual Refrigerator/Oven charges when submitted alongside the bundle", () => {
    const result = calculateEstimate(
      baseInput({ addOnIds: ["refrigerator_oven_bundle", "inside_refrigerator", "inside_oven"] }),
      TEST_OVERRIDES
    );
    expect(result.pricedAddOnsTotal).toBe(55);
    expect(result.pricedAddOns).toEqual([
      { id: "refrigerator_oven_bundle", label: "Refrigerator + Oven Bundle", amount: 55, pricingKind: "fixed" },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Outdoor add-ons flowing through the full engine
// ---------------------------------------------------------------------------

describe("outdoor add-ons integration", () => {
  it("adds outdoor charges to the total, undiscounted, alongside the base cleaning", () => {
    const withoutOutdoor = calculateEstimate(baseInput(), TEST_OVERRIDES);
    const withOutdoor = calculateEstimate(
      baseInput({ outdoorSelection: { garageCars: 2, algaeMildewTreatmentSize: "small" } }),
      TEST_OVERRIDES
    );
    expect(withOutdoor.outdoorChargesTotal).toBe(65 + 50);
    expect(withOutdoor.calculatedTotal).toBeCloseTo(withoutOutdoor.calculatedTotal + 65 + 50);
  });

  it("a component beyond the configured limit is excluded from the total and flagged, without blocking the rest of the instant estimate", () => {
    const result = calculateEstimate(
      baseInput({ outdoorSelection: { garageCars: 2, porchSqFt: 300 } }),
      TEST_OVERRIDES
    );
    expect(result.outdoorCharges).toEqual([{ id: "garage", label: "Garage Cleaning (2-Car)", amount: 65 }]);
    expect(result.outdoorManualCharges).toEqual([{ id: "porch", label: "Porch Cleaning" }]);
    expect(result.manualReviewReasons).toContain("PORCH_BEYOND_CONFIGURED_LIMIT");
    expect(result.estimateType).toBe("instant-range");
    expect(result.manualReviewRequired).toBe(true);
  });

  it("outdoor selections do not price for a prepaid package (no per-visit assignment mechanism exists)", () => {
    const result = calculateEstimate(
      baseInput({
        frequency: "weekly",
        isPrepaidPackage: true,
        visitCount: 6,
        outdoorSelection: { garageCars: 1 },
      }),
      TEST_OVERRIDES
    );
    expect(result.outdoorCharges).toEqual([]);
    expect(result.outdoorChargesTotal).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 36. Basic + all three interior add-ons remains explicit Basic
// ---------------------------------------------------------------------------

describe("Basic with all three interior add-ons", () => {
  it("never silently converts to Complete, but flags it as a better-value recommendation", () => {
    const result = calculateEstimate(
      baseInput({
        cleaningType: "move",
        movePackageLevel: "basic",
        squareFeet: 1300, // Complete upgrade here would be $50
        addOnIds: ["inside_refrigerator", "inside_oven", "inside_cabinets_drawers"], // $35 + $30 + $40 = $105
      }),
      TEST_OVERRIDES
    );
    expect(result.movePackageLevel).toBe("basic");
    expect(result.pricedAddOnsTotal).toBe(105);
    expect(result.completePackageRecommended).toBe(true);
    expect(result.moveCompleteUpgrade).toBe(0);
  });

  it("does not recommend Complete when the standalone total doesn't exceed the upgrade price", () => {
    const result = calculateEstimate(
      baseInput({
        cleaningType: "move",
        movePackageLevel: "basic",
        squareFeet: 4000, // Complete upgrade here is $100
        addOnIds: ["inside_oven"], // $30, well under $100
      }),
      TEST_OVERRIDES
    );
    expect(result.completePackageRecommended).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 37. Move-In and Move-Out both support Basic/Complete
// ---------------------------------------------------------------------------

describe("Move-In vs Move-Out direction", () => {
  it("pricing is identical regardless of direction; the selection is echoed back for display/persistence", () => {
    const moveIn = calculateEstimate(
      baseInput({ cleaningType: "move", moveDirection: "move_in", movePackageLevel: "complete", squareFeet: 1300 }),
      TEST_OVERRIDES
    );
    const moveOut = calculateEstimate(
      baseInput({ cleaningType: "move", moveDirection: "move_out", movePackageLevel: "complete", squareFeet: 1300 }),
      TEST_OVERRIDES
    );
    expect(moveIn.calculatedTotal).toBe(moveOut.calculatedTotal);
    expect(moveIn.moveDirection).toBe("move_in");
    expect(moveOut.moveDirection).toBe("move_out");
  });

  it("moveDirection is null for non-move cleaning types", () => {
    const result = calculateEstimate(baseInput({ cleaningType: "standard" }), TEST_OVERRIDES);
    expect(result.moveDirection).toBeNull();
    expect(result.movePackageLevel).toBeNull();
  });

  it("movePackageLevel defaults to basic when omitted on a move request", () => {
    const result = calculateEstimate(baseInput({ cleaningType: "move" }), TEST_OVERRIDES);
    expect(result.movePackageLevel).toBe("basic");
  });
});

// ---------------------------------------------------------------------------
// 38. Manual/custom condition does not produce a misleading final total
// ---------------------------------------------------------------------------

describe("manual/custom propagation never produces a misleading total", () => {
  it("a Complete request beyond the sq-ft limit still returns a real, honest Basic total rather than an invented Complete price", () => {
    const result = calculateEstimate(
      baseInput({ cleaningType: "move", movePackageLevel: "complete", squareFeet: 5000 }),
      TEST_OVERRIDES
    );
    expect(result.moveCompleteUpgradeConfigured).toBe(false);
    expect(result.moveCompleteUpgrade).toBe(0);
    expect(result.manualReviewRequired).toBe(true);
    expect(result.calculatedTotal).toBeGreaterThan(0);
  });

  it("a garage beyond 3 cars requires custom pricing and is excluded from the numeric total", () => {
    const result = calculateEstimate(baseInput({ outdoorSelection: { garageCars: 5 } }), TEST_OVERRIDES);
    expect(result.outdoorChargesTotal).toBe(0);
    expect(result.outdoorManualCharges).toEqual([{ id: "garage", label: "Garage Cleaning" }]);
    expect(result.manualReviewReasons).toContain("GARAGE_BEYOND_CONFIGURED_LIMIT");
  });
});
