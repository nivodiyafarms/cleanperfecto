// Finalized business rule (owner-approved 2026-08-31): the 6+ prepaid
// package discount is 10% (PACKAGE_DISCOUNT_MULTIPLIER = 0.9), applied
// sequentially after recurring-cycle pricing, was previously 20% (0.8).
// This file proves the fix precisely against the real production
// architecture rather than merely updating expected numbers.
import { describe, expect, it } from "vitest";
import { calculateEstimate } from "./calculate-estimate";
import { PACKAGE_DISCOUNT_MULTIPLIER } from "./config";
import type { SuppliesEquipmentRule } from "./supplies-equipment";
import type { CalculationInput, CleaningType } from "./types";
import type { ZipTravelRule } from "./zip-travel";

const TEST_ZIP_NO_TRAVEL: ZipTravelRule[] = [{ zip: "99999", percentage: 0, band: "core" }];
const ALL_CLEANING_TYPES: CleaningType[] = ["standard", "deep", "move"];
const TEST_SUPPLIES_CONFIG: SuppliesEquipmentRule[] = ALL_CLEANING_TYPES.map((cleaningType) => ({
  cleaningType,
  minSqFt: 0,
  maxSqFt: 100000,
  amount: 15,
}));
const TEST_OVERRIDES = { zipTravelConfig: TEST_ZIP_NO_TRAVEL, suppliesEquipmentConfig: TEST_SUPPLIES_CONFIG };

function baseInput(overrides: Partial<CalculationInput> = {}): CalculationInput {
  return {
    propertyKind: "home",
    cleaningType: "standard",
    condition: "light",
    sizeTier: "2br_2ba",
    zip: "99999",
    frequency: "weekly",
    isPrepaidPackage: true,
    visitCount: 6,
    addOnIds: [],
    firstCleaningEligible: false,
    asOf: new Date("2026-06-01T12:00:00-05:00"),
    ...overrides,
  };
}

describe("PACKAGE_DISCOUNT_MULTIPLIER is finalized at 0.9 (10% off, was 0.8 / 20%)", () => {
  it("the constant itself is 0.9", () => {
    expect(PACKAGE_DISCOUNT_MULTIPLIER).toBe(0.9);
  });
});

// ---------------------------------------------------------------------------
// A. A prepaid 6-cleaning/package quote receives exactly 10% package
//    discount rather than 20%, applied sequentially after the recurring
//    discount (never a naive combined percentage).
// ---------------------------------------------------------------------------

describe("A. exactly 10% package discount, sequential after recurring", () => {
  it("packageDiscount is exactly 10% of the already-recurring-discounted cleaning subtotal", () => {
    const result = calculateEstimate(baseInput(), TEST_OVERRIDES);
    expect(result.discountProgram).toBe("prepaid_package");

    const cleaningSubtotal = 149; // 2br_2ba standard light, no room adjustments
    const afterRecurring = cleaningSubtotal * 0.79; // weekly recurring, unchanged by this fix
    const expectedPackageDiscount = afterRecurring * 0.1; // exactly 10%, not 20%

    expect(result.recurringAdjustment).toBeCloseTo(cleaningSubtotal - afterRecurring);
    expect(result.packageDiscount).toBeCloseTo(expectedPackageDiscount);

    // Structural proof it is NOT the old 20% figure.
    const oldTwentyPercentDiscount = afterRecurring * 0.2;
    expect(result.packageDiscount).not.toBeCloseTo(oldTwentyPercentDiscount);
  });

  it("the combined recurring+package reduction is sequential multiplication, never naive addition", () => {
    const result = calculateEstimate(baseInput(), TEST_OVERRIDES);
    const cleaningSubtotal = 149;
    const totalDiscount = result.recurringAdjustment + result.packageDiscount;

    // Sequential: 149 * (1 - 0.79*0.9) = 149 * 0.289 = 43.061
    const sequential = cleaningSubtotal * (1 - 0.79 * 0.9);
    // Naive additive (21% + 10% = 31%) would give 46.19 — a different, wrong number.
    const naiveAdditive = cleaningSubtotal * 0.31;

    expect(totalDiscount).toBeCloseTo(sequential);
    expect(totalDiscount).not.toBeCloseTo(naiveAdditive);
  });
});

// ---------------------------------------------------------------------------
// B. The same representative quote WITHOUT the prepaid package does not
//    receive the package discount at all (only the plain recurring rate).
// ---------------------------------------------------------------------------

describe("B. the same quote without isPrepaidPackage never receives the package discount", () => {
  it("recurring-only (isPrepaidPackage: false) has packageDiscount === 0 and a higher total than the prepaid package", () => {
    const withPackage = calculateEstimate(baseInput({ isPrepaidPackage: true }), TEST_OVERRIDES);
    const withoutPackage = calculateEstimate(baseInput({ isPrepaidPackage: false }), TEST_OVERRIDES);

    expect(withPackage.discountProgram).toBe("prepaid_package");
    expect(withoutPackage.discountProgram).toBe("recurring_cycle");
    expect(withoutPackage.packageDiscount).toBe(0);
    expect(withoutPackage.calculatedTotal).toBeGreaterThan(withPackage.calculatedTotal);
  });

  it("fewer than 6 prepaid visits also never receives the package discount", () => {
    const result = calculateEstimate(baseInput({ isPrepaidPackage: true, visitCount: 5 }), TEST_OVERRIDES);
    expect(result.discountProgram).toBe("recurring_cycle");
    expect(result.packageDiscount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// C. Package-ineligible add-ons remain undiscounted — including every new
//    hotfix addition (indoor bundle, quantified windows, outdoor charges,
//    oil/degrease, algae/mildew, and the Move Complete upgrade). Game Room /
//    Media Room are the one deliberate exception: the existing architecture
//    already folds room adjustments into the discount-eligible cleaning
//    base, and this hotfix's special rooms reuse that exact mechanism —
//    verified explicitly below, not assumed.
// ---------------------------------------------------------------------------

describe("C. package-ineligible charges remain undiscounted", () => {
  it("visit-specific add-ons (packageAddOnsTotal) are added in full, never reduced by the 10% package rate", () => {
    const withoutAddOn = calculateEstimate(baseInput(), TEST_OVERRIDES);
    const withAddOn = calculateEstimate(
      baseInput({ visitAddOns: [["refrigerator_oven_bundle"]] }),
      TEST_OVERRIDES
    );
    expect(withAddOn.packageAddOnsTotal).toBe(55); // full $55 bundle price, not $55 * 0.9 or * 0.711
    expect(withAddOn.prepaidPackageTotal! - withoutAddOn.prepaidPackageTotal!).toBeCloseTo(55);
  });

  it("outdoor charges, quantified windows, and condition treatments do not price at all for a prepaid package (no per-visit assignment mechanism) — never partially discounted", () => {
    const result = calculateEstimate(
      baseInput({
        outdoorSelection: { trio: "small", algaeMildewTreatmentSize: "large", oilDegreaseAffectedBays: 2 },
        quantifiedAddOns: [{ id: "interior_window_detailing", quantity: 5 }],
      }),
      TEST_OVERRIDES
    );
    expect(result.outdoorCharges).toEqual([]);
    expect(result.outdoorChargesTotal).toBe(0);
    expect(result.quantifiedAddOns).toEqual([]);
    expect(result.quantifiedAddOnsTotal).toBe(0);
  });

  it("the Move Complete square-footage upgrade is added after the package discount is applied, at full price", () => {
    const basic = calculateEstimate(
      baseInput({ cleaningType: "move", movePackageLevel: "basic", squareFeet: 1300 }),
      TEST_OVERRIDES
    );
    const complete = calculateEstimate(
      baseInput({ cleaningType: "move", movePackageLevel: "complete", squareFeet: 1300 }),
      TEST_OVERRIDES
    );
    expect(complete.moveCompleteUpgrade).toBe(50); // full, undiscounted upgrade amount
    expect(complete.calculatedTotal).toBeCloseTo(basic.calculatedTotal + 50);
  });

  it("Game Room / Media Room DO participate in the package discount — they are folded into the discount-eligible cleaning base by the existing room-adjustment architecture, same as bedrooms/bathrooms", () => {
    const without = calculateEstimate(baseInput(), TEST_OVERRIDES);
    const withGameRoom = calculateEstimate(baseInput({ specialRooms: ["game_room"] }), TEST_OVERRIDES);

    // Standard Game Room = +$15 to the cleaning subtotal, itself subject to
    // the same weekly (0.79) x package (0.9) sequential discount as the rest
    // of the base — NOT the full +$15 flowing straight through. Compared at
    // 1-decimal precision since calculatedTotal is cent-rounded independently
    // on each side, which can introduce up to a cent of combined rounding.
    const expectedDelta = 15 * 0.79 * 0.9;
    expect(withGameRoom.calculatedTotal - without.calculatedTotal).toBeCloseTo(expectedDelta, 1);
    expect(withGameRoom.calculatedTotal - without.calculatedTotal).toBeLessThan(15); // proof it WAS discounted, unlike the add-ons above
  });
});

// ---------------------------------------------------------------------------
// D. Existing frequency (recurring-cycle) and first-cleaning discounts are
//    completely unaffected by this fix — only the prepaid-package multiplier
//    changed.
// ---------------------------------------------------------------------------

describe("D. frequency and first-cleaning discounts are unchanged", () => {
  it.each([
    { frequency: "weekly" as const, expectedRate: 0.21 },
    { frequency: "biweekly" as const, expectedRate: 0.14 },
    { frequency: "every_4_weeks" as const, expectedRate: 0.07 },
  ])("$frequency recurring-only discount is still exactly $expectedRate", ({ frequency, expectedRate }) => {
    const result = calculateEstimate(
      baseInput({ frequency, isPrepaidPackage: false, visitCount: 1 }),
      TEST_OVERRIDES
    );
    expect(result.discountProgram).toBe("recurring_cycle");
    expect(result.recurringAdjustment).toBeCloseTo(149 * expectedRate);
  });

  it.each([
    { asOf: new Date("2026-08-15T12:00:00-05:00"), expectedPercent: 30 },
    { asOf: new Date("2026-09-05T00:00:00-05:00"), expectedPercent: 25 },
  ])("first-cleaning offer is still exactly $expectedPercent% and is unaffected by the package multiplier", ({ asOf, expectedPercent }) => {
    const result = calculateEstimate(
      baseInput({ frequency: "one_time", isPrepaidPackage: false, visitCount: 1, firstCleaningEligible: true, asOf }),
      TEST_OVERRIDES
    );
    expect(result.discountProgram).toBe("first_cleaning");
    expect(result.activeFirstCleaningOfferPercent).toBe(expectedPercent);
    expect(result.firstCleaningDiscount).toBeCloseTo(149 * (expectedPercent / 100));
  });
});
