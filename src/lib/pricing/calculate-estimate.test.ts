import { describe, expect, it } from "vitest";
import { calculateEstimate } from "./calculate-estimate";
import type { SuppliesEquipmentRule } from "./supplies-equipment";
import type { CalculationInput, CleaningType, SizeTier } from "./types";
import type { ZipTravelRule } from "./zip-travel";

// ---------------------------------------------------------------------------
// TEST-ONLY fixtures — clearly isolated from production config (which stays
// empty/unconfigured until the owner approves real ZIP, supplies, sqft, and
// room-adjustment tables). Never copy these values into production config.
// ---------------------------------------------------------------------------

const TEST_ZIP_NO_TRAVEL: ZipTravelRule[] = [{ zip: "99999", percentage: 0, band: "test-fixture" }];

const ALL_SIZE_TIERS: SizeTier[] = ["studio_1ba", "1br_1ba", "2br_2ba", "3br_2ba", "4br_plus"];
const ALL_CLEANING_TYPES: CleaningType[] = ["standard", "deep", "move"];

// A small flat $15 test-only supplies fixture — matches the owner's own
// §26/§27 worked examples ("assume an approved small Standard supplies
// charge is available") so the acceptance-case tests below reproduce their
// numbers exactly.
const TEST_SUPPLIES_CONFIG: SuppliesEquipmentRule[] = ALL_CLEANING_TYPES.flatMap((cleaningType) =>
  ALL_SIZE_TIERS.map((sizeTier) => ({ cleaningType, sizeTier, amount: 15 }))
);

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

function expectedRangeBounds(calculatedTotal: number, rangeMultiplier: number) {
  const lower = Math.max(99, Math.ceil(calculatedTotal / 5) * 5);
  const upper = Math.max(lower, Math.ceil((calculatedTotal * rangeMultiplier) / 5) * 5);
  return { lower, upper };
}

// ---------------------------------------------------------------------------
// Base prices by property/service combination
// ---------------------------------------------------------------------------

describe("base prices by property/service combination", () => {
  const cases: { label: string; cleaningType: CleaningType; sizeTier: SizeTier; expectedBase: number }[] = [
    { label: "Studio Standard", cleaningType: "standard", sizeTier: "studio_1ba", expectedBase: 109 },
    { label: "Studio Deep", cleaningType: "deep", sizeTier: "studio_1ba", expectedBase: 169 },
    { label: "1B1B Standard", cleaningType: "standard", sizeTier: "1br_1ba", expectedBase: 129 },
    { label: "1B1B Deep", cleaningType: "deep", sizeTier: "1br_1ba", expectedBase: 199 },
    { label: "2B2B Standard", cleaningType: "standard", sizeTier: "2br_2ba", expectedBase: 149 },
    { label: "2B2B Deep", cleaningType: "deep", sizeTier: "2br_2ba", expectedBase: 229 },
    { label: "3B2B Standard", cleaningType: "standard", sizeTier: "3br_2ba", expectedBase: 179 },
    { label: "3B2B Deep", cleaningType: "deep", sizeTier: "3br_2ba", expectedBase: 279 },
    { label: "4+ Standard", cleaningType: "standard", sizeTier: "4br_plus", expectedBase: 209 },
    { label: "4+ Deep", cleaningType: "deep", sizeTier: "4br_plus", expectedBase: 329 },
  ];

  it.each(cases)(
    "$label uses the approved base price of $expectedBase",
    ({ cleaningType, sizeTier, expectedBase }) => {
      const result = calculateEstimate(baseInput({ cleaningType, sizeTier, condition: "light" }), TEST_OVERRIDES);
      expect(result.basePrice).toBe(expectedBase);
      expect(result.cleaningSubtotal).toBe(expectedBase); // Light multiplier = 1.00, no room/sqft adjustment
      expect(result.estimateType).toBe("instant-range");
    }
  );

  it("Move-In/Move-Out uses the flat $199 starting base regardless of size tier", () => {
    const small = calculateEstimate(baseInput({ cleaningType: "move", sizeTier: "studio_1ba" }), TEST_OVERRIDES);
    const large = calculateEstimate(baseInput({ cleaningType: "move", sizeTier: "4br_plus" }), TEST_OVERRIDES);
    expect(small.basePrice).toBe(199);
    expect(large.basePrice).toBe(199);
  });
});

// ---------------------------------------------------------------------------
// Condition rules
// ---------------------------------------------------------------------------

describe("condition multipliers", () => {
  it("Standard Light and Moderate both use multiplier 1.00", () => {
    const light = calculateEstimate(baseInput({ cleaningType: "standard", condition: "light" }), TEST_OVERRIDES);
    const moderate = calculateEstimate(
      baseInput({ cleaningType: "standard", condition: "moderate" }),
      TEST_OVERRIDES
    );
    expect(light.conditionMultiplier).toBe(1);
    expect(moderate.conditionMultiplier).toBe(1);
  });

  it("Standard Heavy applies ×1.15 and remains available with a positive Deep recommendation", () => {
    const result = calculateEstimate(baseInput({ cleaningType: "standard", condition: "heavy" }), TEST_OVERRIDES);
    expect(result.conditionMultiplier).toBe(1.15);
    expect(result.estimateType).toBe("instant-range");
    expect(result.recommendedService).toBe("deep");
  });

  it("Standard Extensive is rejected — Deep Cleaning is required, no invented price", () => {
    const result = calculateEstimate(baseInput({ cleaningType: "standard", condition: "extensive" }), TEST_OVERRIDES);
    expect(result.estimateType).toBe("manual-review");
    expect(result.manualReviewReasons).toContain("CONDITION_NOT_AVAILABLE_FOR_SERVICE");
    expect(result.recommendedService).toBe("deep");
    expect(result.range).toBeNull();
  });

  it("Deep Heavy applies ×1.15", () => {
    const result = calculateEstimate(baseInput({ cleaningType: "deep", condition: "heavy" }), TEST_OVERRIDES);
    expect(result.conditionMultiplier).toBe(1.15);
    expect(result.recommendedService).toBeNull();
  });

  it("Deep Extensive applies ×1.20", () => {
    const result = calculateEstimate(baseInput({ cleaningType: "deep", condition: "extensive" }), TEST_OVERRIDES);
    expect(result.conditionMultiplier).toBe(1.2);
  });

  it("Move Heavy applies ×1.15, matching the Deep Cleaning table", () => {
    const result = calculateEstimate(baseInput({ cleaningType: "move", condition: "heavy" }), TEST_OVERRIDES);
    expect(result.conditionMultiplier).toBe(1.15);
  });

  it("Move Extensive applies ×1.20, matching the Deep Cleaning table", () => {
    const result = calculateEstimate(baseInput({ cleaningType: "move", condition: "extensive" }), TEST_OVERRIDES);
    expect(result.conditionMultiplier).toBe(1.2);
  });
});

// ---------------------------------------------------------------------------
// Range generation
// ---------------------------------------------------------------------------

describe("customer-facing range generation", () => {
  it("matches the owner's worked example: $144 calculated total displays as $145–$155 (Light, +5%)", () => {
    const result = calculateEstimate(
      baseInput({ cleaningType: "standard", sizeTier: "1br_1ba", condition: "light" }),
      TEST_OVERRIDES
    );
    expect(result.calculatedTotal).toBe(144);
    expect(result.range).toEqual({ lower: 145, upper: 155 });
  });

  it("Moderate uses a +7% range ceiling", () => {
    const result = calculateEstimate(
      baseInput({ cleaningType: "standard", sizeTier: "1br_1ba", condition: "moderate" }),
      TEST_OVERRIDES
    );
    expect(result.range).toEqual(expectedRangeBounds(result.calculatedTotal, 1.07));
  });

  it("Heavy uses a +10% range ceiling", () => {
    const result = calculateEstimate(
      baseInput({ cleaningType: "deep", sizeTier: "2br_2ba", condition: "heavy" }),
      TEST_OVERRIDES
    );
    expect(result.range).toEqual(expectedRangeBounds(result.calculatedTotal, 1.1));
  });

  it("Extensive Deep uses a +15% range ceiling", () => {
    const result = calculateEstimate(
      baseInput({ cleaningType: "deep", sizeTier: "3br_2ba", condition: "extensive" }),
      TEST_OVERRIDES
    );
    expect(result.range).toEqual(expectedRangeBounds(result.calculatedTotal, 1.15));
  });

  it("never rounds the lower bound below the actual calculated amount", () => {
    const result = calculateEstimate(
      baseInput({ cleaningType: "standard", sizeTier: "studio_1ba", condition: "light" }),
      TEST_OVERRIDES
    );
    expect(result.range!.lower).toBeGreaterThanOrEqual(result.calculatedTotal);
  });

  it("never displays a range lower bound below $99", () => {
    const result = calculateEstimate(
      baseInput({ cleaningType: "standard", sizeTier: "studio_1ba", condition: "light" }),
      TEST_OVERRIDES
    );
    expect(result.range!.lower).toBeGreaterThanOrEqual(99);
  });
});

// ---------------------------------------------------------------------------
// First-cleaning offer integration
// ---------------------------------------------------------------------------

describe("first-cleaning offer integration", () => {
  it("applies up to 30% before the launch deadline for an eligible one-time customer", () => {
    const result = calculateEstimate(
      baseInput({
        cleaningType: "standard",
        sizeTier: "1br_1ba",
        condition: "light",
        firstCleaningEligible: true,
        asOf: new Date("2026-08-15T12:00:00-05:00"),
      }),
      TEST_OVERRIDES
    );
    expect(result.activeFirstCleaningOfferPercent).toBe(30);
    expect(result.discountProgram).toBe("first_cleaning");
    expect(result.firstCleaningDiscount).toBeCloseTo(129 * 0.3);
    expect(result.calculatedTotal).toBeCloseTo(144 - 38.7);
  });

  it("automatically switches to up to 25% on and after September 1, 2026, with no client redeploy", () => {
    const result = calculateEstimate(
      baseInput({
        cleaningType: "standard",
        sizeTier: "1br_1ba",
        condition: "light",
        firstCleaningEligible: true,
        asOf: new Date("2026-09-05T00:00:00-05:00"),
      }),
      TEST_OVERRIDES
    );
    expect(result.activeFirstCleaningOfferPercent).toBe(25);
    expect(result.firstCleaningDiscount).toBeCloseTo(129 * 0.25);
  });

  it("applies no discount for an ineligible customer even during an active offer window", () => {
    const result = calculateEstimate(
      baseInput({
        cleaningType: "standard",
        sizeTier: "1br_1ba",
        condition: "light",
        firstCleaningEligible: false,
        asOf: new Date("2026-08-15T12:00:00-05:00"),
      }),
      TEST_OVERRIDES
    );
    expect(result.activeFirstCleaningOfferPercent).toBeNull();
    expect(result.firstCleaningDiscount).toBe(0);
    expect(result.discountProgram).toBe("none");
  });

  it("discounts only the cleaning-service portion — never travel, supplies, or add-ons", () => {
    const result = calculateEstimate(
      baseInput({
        cleaningType: "standard",
        sizeTier: "1br_1ba",
        condition: "light",
        firstCleaningEligible: true,
        asOf: new Date("2026-08-15T12:00:00-05:00"),
        addOnIds: ["inside_oven"],
      }),
      {
        zipTravelConfig: [{ zip: "99999", percentage: 0.1, band: "test-fixture" }],
        suppliesEquipmentConfig: TEST_SUPPLIES_CONFIG,
      }
    );
    expect(result.travelCharge).toBeCloseTo(12.9); // 10% of the $129 cleaning subtotal, not discounted
    expect(result.suppliesEquipmentCharge).toBe(15);
    expect(result.pricedAddOnsTotal).toBe(35);
    expect(result.firstCleaningDiscount).toBeCloseTo(129 * 0.3);
    expect(result.preDiscountTotal).toBeCloseTo(129 + 12.9 + 15 + 35);
  });
});

// ---------------------------------------------------------------------------
// $99 minimum service total
// ---------------------------------------------------------------------------

describe("$99 minimum service total", () => {
  it("caps the first-cleaning discount so the total never drops below $99 (owner worked example)", () => {
    const result = calculateEstimate(
      baseInput({
        cleaningType: "standard",
        sizeTier: "studio_1ba",
        condition: "light",
        firstCleaningEligible: true,
        asOf: new Date("2026-08-15T12:00:00-05:00"),
      }),
      TEST_OVERRIDES // supplies=$15, travel=$0 → preDiscountTotal = $109 + $15 = $124
    );
    expect(result.preDiscountTotal).toBe(124);
    expect(result.firstCleaningDiscount).toBeCloseTo(25); // capped down from the requested $32.70
    expect(result.calculatedTotal).toBe(99);
    expect(result.minimumServiceTotalApplied).toBe(true);
    expect(result.range).toEqual({ lower: 99, upper: expect.any(Number) });
  });

  it("never lets the calculated total fall below $99 under any discount program", () => {
    const scenarios: CalculationInput[] = [
      baseInput({
        sizeTier: "studio_1ba",
        firstCleaningEligible: true,
        asOf: new Date("2026-08-15T12:00:00-05:00"),
      }),
      baseInput({
        sizeTier: "studio_1ba",
        frequency: "weekly",
        isPrepaidPackage: true,
        visitCount: 6,
        firstCleaningEligible: false,
      }),
    ];
    for (const input of scenarios) {
      const result = calculateEstimate(input, TEST_OVERRIDES);
      expect(result.calculatedTotal).toBeGreaterThanOrEqual(99);
    }
  });
});

// ---------------------------------------------------------------------------
// Recurring-cycle pricing (engine wiring — see discount-program.test.ts for
// isolated coverage of the selection logic itself)
// ---------------------------------------------------------------------------

describe("recurring-cycle pricing", () => {
  it.each([
    { frequency: "weekly" as const, expectedPercent: 0.21 },
    { frequency: "biweekly" as const, expectedPercent: 0.14 },
    { frequency: "every_4_weeks" as const, expectedPercent: 0.07 },
  ])("$frequency reduces the cleaning subtotal by $expectedPercent when not eligible", ({ frequency, expectedPercent }) => {
    const result = calculateEstimate(
      baseInput({ cleaningType: "standard", sizeTier: "2br_2ba", condition: "light", frequency, firstCleaningEligible: false }),
      TEST_OVERRIDES
    );
    expect(result.discountProgram).toBe("recurring_cycle");
    expect(result.recurringAdjustment).toBeCloseTo(149 * expectedPercent);
  });

  it("compares the first-cleaning offer against recurring pricing on the first visit and applies only the better one", () => {
    const result = calculateEstimate(
      baseInput({
        cleaningType: "standard",
        sizeTier: "2br_2ba",
        condition: "light",
        frequency: "weekly",
        firstCleaningEligible: true,
        asOf: new Date("2026-08-15T12:00:00-05:00"),
      }),
      TEST_OVERRIDES
    );
    // 30% ($44.70) beats 21% weekly ($31.29) on $149 — first-cleaning applies alone, not combined.
    expect(result.discountProgram).toBe("first_cleaning");
    expect(result.recurringAdjustment).toBe(0);
    expect(result.firstCleaningDiscount).toBeCloseTo(149 * 0.3);
  });
});

// ---------------------------------------------------------------------------
// 6+ prepaid package
// ---------------------------------------------------------------------------

describe("6+ prepaid package", () => {
  it("fewer than 6 prepaid visits uses recurring pricing only", () => {
    const result = calculateEstimate(
      baseInput({ sizeTier: "2br_2ba", frequency: "weekly", isPrepaidPackage: true, visitCount: 4 }),
      TEST_OVERRIDES
    );
    expect(result.discountProgram).toBe("recurring_cycle");
    expect(result.packageDiscount).toBe(0);
  });

  it("exactly 6 prepaid visits applies the sequential package discount", () => {
    const result = calculateEstimate(
      baseInput({ sizeTier: "2br_2ba", frequency: "weekly", isPrepaidPackage: true, visitCount: 6 }),
      TEST_OVERRIDES
    );
    expect(result.discountProgram).toBe("prepaid_package");
    expect(result.packageDiscount).toBeGreaterThan(0);
  });

  it("more than 6 prepaid visits applies the sequential package discount", () => {
    const result = calculateEstimate(
      baseInput({ sizeTier: "2br_2ba", frequency: "weekly", isPrepaidPackage: true, visitCount: 12 }),
      TEST_OVERRIDES
    );
    expect(result.discountProgram).toBe("prepaid_package");
  });

  it("6+ visits that are not prepaid does not receive the package discount", () => {
    const result = calculateEstimate(
      baseInput({ sizeTier: "2br_2ba", frequency: "weekly", isPrepaidPackage: false, visitCount: 6 }),
      TEST_OVERRIDES
    );
    expect(result.discountProgram).toBe("recurring_cycle");
    expect(result.packageDiscount).toBe(0);
  });

  it("never applies the first-cleaning offer alongside the prepaid package, even when eligible", () => {
    const result = calculateEstimate(
      baseInput({
        sizeTier: "2br_2ba",
        frequency: "weekly",
        isPrepaidPackage: true,
        visitCount: 6,
        firstCleaningEligible: true,
        asOf: new Date("2026-08-15T12:00:00-05:00"),
      }),
      TEST_OVERRIDES
    );
    expect(result.discountProgram).toBe("prepaid_package");
    expect(result.firstCleaningDiscount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Add-ons
// ---------------------------------------------------------------------------

describe("add-ons", () => {
  it("adds the fixed $35 Inside Oven and Inside Refrigerator charges", () => {
    const result = calculateEstimate(baseInput({ addOnIds: ["inside_oven", "inside_refrigerator"] }), TEST_OVERRIDES);
    expect(result.pricedAddOnsTotal).toBe(70);
  });

  it("uses the approved starting-at amount without inventing a higher final figure", () => {
    const result = calculateEstimate(
      baseInput({ addOnIds: ["inside_cabinets_drawers", "extra_pet_hair_removal"] }),
      TEST_OVERRIDES
    );
    expect(result.pricedAddOnsTotal).toBe(60);
    expect(result.pricedAddOns.every((addOn) => addOn.pricingKind === "starting_at")).toBe(true);
  });

  it("preserves Boxing & Packing as manual-quote, flags review, but does not block the instant range", () => {
    const result = calculateEstimate(baseInput({ addOnIds: ["boxing_packing"] }), TEST_OVERRIDES);
    expect(result.manualQuoteAddOns).toEqual([{ id: "boxing_packing", label: "Boxing & Packing" }]);
    expect(result.manualReviewRequired).toBe(true);
    expect(result.manualReviewReasons).toContain("MANUAL_QUOTE_ADD_ON_SELECTED");
    expect(result.estimateType).toBe("instant-range");
    expect(result.range).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// ZIP travel allocation
// ---------------------------------------------------------------------------

describe("ZIP travel allocation", () => {
  it("the same configured ZIP always produces the same travel percentage and charge", () => {
    const overrides = {
      zipTravelConfig: [{ zip: "99999", percentage: 0.08, band: "test-fixture" }],
      suppliesEquipmentConfig: TEST_SUPPLIES_CONFIG,
    };
    const first = calculateEstimate(baseInput(), overrides);
    const second = calculateEstimate(baseInput(), overrides);
    expect(first.travelPercentage).toBe(0.08);
    expect(second.travelPercentage).toBe(0.08);
    expect(first.travelCharge).toBe(second.travelCharge);
  });

  it("an unknown ZIP returns manual review instead of an invented percentage", () => {
    const result = calculateEstimate(baseInput({ zip: "00000" }), { suppliesEquipmentConfig: TEST_SUPPLIES_CONFIG });
    expect(result.estimateType).toBe("manual-review");
    expect(result.manualReviewReasons).toContain("ZIP_TRAVEL_NOT_CONFIGURED");
  });
});

// ---------------------------------------------------------------------------
// Square footage / room adjustments
// ---------------------------------------------------------------------------

describe("square footage and room adjustments", () => {
  it("skips the square-footage multiplier (1.00, no review) when square footage isn't provided", () => {
    const result = calculateEstimate(baseInput(), TEST_OVERRIDES);
    expect(result.squareFootageMultiplier).toBe(1);
    expect(result.squareFootageConfigured).toBe(true);
    expect(result.estimateType).toBe("instant-range");
  });

  it("routes to manual review instead of silently defaulting to 1.00 when square footage is provided but unconfigured", () => {
    const result = calculateEstimate(baseInput({ squareFeet: 1200 }), TEST_OVERRIDES);
    expect(result.squareFootageConfigured).toBe(false);
    expect(result.estimateType).toBe("manual-review");
    expect(result.manualReviewReasons).toContain("SQUARE_FOOTAGE_NOT_CONFIGURED");
  });

  it("skips room adjustments when actual rooms are not provided or fit the tier baseline", () => {
    const result = calculateEstimate(
      baseInput({ rooms: { bedrooms: 1, fullBathrooms: 1, halfBathrooms: 0 }, sizeTier: "1br_1ba" }),
      TEST_OVERRIDES
    );
    expect(result.roomAdjustmentConfigured).toBe(true);
    expect(result.roomAdjustments).toBe(0);
  });

  it("routes to manual review when extra rooms are reported but unconfigured in production", () => {
    const result = calculateEstimate(
      baseInput({ rooms: { bedrooms: 2, fullBathrooms: 1, halfBathrooms: 0 }, sizeTier: "1br_1ba" }),
      TEST_OVERRIDES
    );
    expect(result.roomAdjustmentConfigured).toBe(false);
    expect(result.estimateType).toBe("manual-review");
    expect(result.manualReviewReasons).toContain("ROOM_ADJUSTMENT_NOT_CONFIGURED");
  });
});

// ---------------------------------------------------------------------------
// Apartment / Airbnb
// ---------------------------------------------------------------------------

describe("Apartment property kind", () => {
  it("uses the same residential base price and total as Home", () => {
    const home = calculateEstimate(baseInput({ propertyKind: "home" }), TEST_OVERRIDES);
    const apartment = calculateEstimate(baseInput({ propertyKind: "apartment" }), TEST_OVERRIDES);
    expect(apartment.basePrice).toBe(home.basePrice);
    expect(apartment.calculatedTotal).toBe(home.calculatedTotal);
  });
});

describe("Airbnb", () => {
  it("uses the same base price and condition-based range rules as Home — no special widening", () => {
    const home = calculateEstimate(
      baseInput({ propertyKind: "home", cleaningType: "standard", sizeTier: "2br_2ba", condition: "light" }),
      TEST_OVERRIDES
    );
    const airbnb = calculateEstimate(
      baseInput({ propertyKind: "airbnb", cleaningType: "standard", sizeTier: "2br_2ba", condition: "light" }),
      TEST_OVERRIDES
    );
    expect(airbnb.basePrice).toBe(home.basePrice);
    expect(airbnb.range).toEqual(home.range);
  });

  it("preserves uncertain Airbnb extras as manual-quote add-ons rather than widening the range", () => {
    const result = calculateEstimate(baseInput({ propertyKind: "airbnb", addOnIds: ["heavy_organization"] }), TEST_OVERRIDES);
    expect(result.manualQuoteAddOns).toEqual([{ id: "heavy_organization", label: "Heavy Organization" }]);
    expect(result.range).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Commercial properties — office/clinic/restaurant/other all collapse to the
// single "commercial" PropertyKind at the pricing-engine layer (owner-
// approved architecture, item 1), so exercising "commercial" covers all four.
// ---------------------------------------------------------------------------

describe("commercial properties", () => {
  it.each(["light", "heavy"] as const)(
    "always routes to manual review regardless of other inputs (%s condition)",
    (condition) => {
      const result = calculateEstimate(
        baseInput({ propertyKind: "commercial", cleaningType: "deep", condition }),
        TEST_OVERRIDES
      );
      expect(result.estimateType).toBe("manual-review");
      expect(result.manualReviewReasons).toEqual(["COMMERCIAL_PROPERTY"]);
      expect(result.range).toBeNull();
    }
  );
});

// ---------------------------------------------------------------------------
// Security / validation
// ---------------------------------------------------------------------------

describe("security and validation", () => {
  it("ignores any client-supplied total/percentage/multiplier — CalculationInput has no such fields to override", () => {
    const cleanInput = baseInput({ cleaningType: "standard", sizeTier: "1br_1ba", condition: "light" });
    const tampered = {
      ...cleanInput,
      calculatedTotal: 1,
      activeFirstCleaningOfferPercent: 999,
      conditionMultiplier: 100,
    } as unknown as CalculationInput;

    const clean = calculateEstimate(cleanInput, TEST_OVERRIDES);
    const result = calculateEstimate(tampered, TEST_OVERRIDES);

    expect(result).toEqual(clean);
  });

  it("rejects the invalid Standard + Extensive combination rather than inventing a price", () => {
    const result = calculateEstimate(baseInput({ cleaningType: "standard", condition: "extensive" }), TEST_OVERRIDES);
    expect(result.estimateType).toBe("manual-review");
    expect(result.range).toBeNull();
  });

  it("never returns a negative subtotal or total", () => {
    const result = calculateEstimate(baseInput({ sizeTier: "studio_1ba", condition: "light" }), TEST_OVERRIDES);
    expect(result.cleaningSubtotal).toBeGreaterThanOrEqual(0);
    expect(result.calculatedTotal).toBeGreaterThanOrEqual(0);
    expect(result.preDiscountTotal).toBeGreaterThanOrEqual(0);
  });

  it("is deterministic: identical input always produces an identical result", () => {
    const input = baseInput({
      cleaningType: "deep",
      sizeTier: "3br_2ba",
      condition: "heavy",
      firstCleaningEligible: true,
      asOf: new Date("2026-08-15T12:00:00-05:00"),
    });
    const first = calculateEstimate(input, TEST_OVERRIDES);
    const second = calculateEstimate({ ...input, asOf: new Date(input.asOf.getTime()) }, TEST_OVERRIDES);
    expect(first).toEqual(second);
  });
});
