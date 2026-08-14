import { describe, expect, it } from "vitest";
import { calculateEstimate } from "./calculate-estimate";
import type { RoomAdjustmentConfig } from "./room-adjustments";
import type { SuppliesEquipmentRule } from "./supplies-equipment";
import type { CalculationInput, CleaningType, Condition, SizeTier } from "./types";
import type { TravelBand, ZipTravelRule } from "./zip-travel";

// ---------------------------------------------------------------------------
// TEST-ONLY fixtures — isolated from production config so these tests stay
// deterministic and independent of the real ZIP/supplies/sqft/room tables in
// config.ts, zip-travel.ts, supplies-equipment.ts, room-adjustments.ts, and
// square-footage.ts. Never copy these values into production config. Tests
// that specifically want to exercise the *real* production tables omit these
// overrides — see the "production config wiring" and "square footage and
// room adjustments" describe blocks below.
// ---------------------------------------------------------------------------

const TEST_ZIP_NO_TRAVEL: ZipTravelRule[] = [{ zip: "99999", percentage: 0, band: "core" }];

const ALL_CLEANING_TYPES: CleaningType[] = ["standard", "deep", "move"];

// A flat $15 test-only supplies fixture, wide enough to match any effective
// square footage the tests below might resolve to.
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

const RANGE_PERCENTAGE: Record<Condition, number> = { light: 1.05, moderate: 1.07, heavy: 1.1, extensive: 1.15 };
const RANGE_MIN_GAP: Record<Condition, number> = { light: 20, moderate: 25, heavy: 30, extensive: 30 };

/** Independent re-derivation of the approved range formula (owner-approved 2026-08-13), used to check end-to-end wiring rather than duplicating estimate-range.ts's own unit tests. */
function expectedRangeBounds(calculatedTotal: number, condition: Condition) {
  const lower = Math.max(99, Math.ceil(calculatedTotal / 5) * 5);
  const percentageUpper = calculatedTotal * RANGE_PERCENTAGE[condition];
  const minimumGapUpper = lower + RANGE_MIN_GAP[condition];
  const upper = Math.ceil(Math.max(percentageUpper, minimumGapUpper) / 5) * 5;
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
// Range generation — owner-approved 2026-08-13 percentage-vs-minimum-gap rule
// (see estimate-range.test.ts for isolated coverage of the helper itself)
// ---------------------------------------------------------------------------

describe("customer-facing range generation", () => {
  it("owner worked example: $144 calculated total displays as $145-$165 (Light — minimum $20 gap wins over the 5% spread)", () => {
    const result = calculateEstimate(
      baseInput({ cleaningType: "standard", sizeTier: "1br_1ba", condition: "light" }),
      TEST_OVERRIDES
    );
    expect(result.calculatedTotal).toBe(144);
    expect(result.range).toEqual({ lower: 145, upper: 165 });
  });

  it("Moderate uses a +7% percentage spread with a $25 minimum gap floor", () => {
    const result = calculateEstimate(
      baseInput({ cleaningType: "standard", sizeTier: "1br_1ba", condition: "moderate" }),
      TEST_OVERRIDES
    );
    expect(result.range).toEqual(expectedRangeBounds(result.calculatedTotal, "moderate"));
  });

  it("Heavy uses a +10% percentage spread with a $30 minimum gap floor", () => {
    const result = calculateEstimate(
      baseInput({ cleaningType: "deep", sizeTier: "2br_2ba", condition: "heavy" }),
      TEST_OVERRIDES
    );
    expect(result.range).toEqual(expectedRangeBounds(result.calculatedTotal, "heavy"));
  });

  it("Extensive Deep uses a +15% percentage spread with a $30 minimum gap floor", () => {
    const result = calculateEstimate(
      baseInput({ cleaningType: "deep", sizeTier: "3br_2ba", condition: "extensive" }),
      TEST_OVERRIDES
    );
    expect(result.range).toEqual(expectedRangeBounds(result.calculatedTotal, "extensive"));
  });

  it("a large job's percentage spread naturally exceeds the minimum gap floor", () => {
    // Large Heavy job: high enough total that 10% > the $30 minimum gap.
    const result = calculateEstimate(
      baseInput({
        cleaningType: "deep",
        sizeTier: "4br_plus",
        condition: "heavy",
        rooms: { bedrooms: 6, fullBathrooms: 3, halfBathrooms: 0 },
      }),
      TEST_OVERRIDES
    );
    const percentageSpread = result.calculatedTotal * 0.1;
    expect(percentageSpread).toBeGreaterThan(30);
    expect(result.range).toEqual(expectedRangeBounds(result.calculatedTotal, "heavy"));
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
        zipTravelConfig: [{ zip: "99999", percentage: 0.1, band: "extended" as TravelBand }],
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

  // -------------------------------------------------------------------------
  // prepaidPackageTotal — total for ALL prepaid visits, not just one
  // (milestone correction #3, owner-approved 2026-08-13). calculatedTotal
  // remains the effective PER-VISIT price for every discount program,
  // unchanged; prepaidPackageTotal is a new, additive field populated only
  // for discountProgram === "prepaid_package".
  // -------------------------------------------------------------------------

  it("prepaidPackageTotal is null for every discount program except prepaid_package", () => {
    const oneTime = calculateEstimate(baseInput({ sizeTier: "2br_2ba" }), TEST_OVERRIDES);
    const recurring = calculateEstimate(
      baseInput({ sizeTier: "2br_2ba", frequency: "weekly" }),
      TEST_OVERRIDES
    );
    const belowThreshold = calculateEstimate(
      baseInput({ sizeTier: "2br_2ba", frequency: "weekly", isPrepaidPackage: true, visitCount: 4 }),
      TEST_OVERRIDES
    );
    expect(oneTime.discountProgram).toBe("none");
    expect(oneTime.prepaidPackageTotal).toBeNull();
    expect(recurring.discountProgram).toBe("recurring_cycle");
    expect(recurring.prepaidPackageTotal).toBeNull();
    expect(belowThreshold.discountProgram).toBe("recurring_cycle");
    expect(belowThreshold.prepaidPackageTotal).toBeNull();
  });

  it("computes the correct total for all 6 prepaid visits — cleaning portion is discounted × visitCount, travel/supplies are undiscounted × visitCount", () => {
    const result = calculateEstimate(
      baseInput({ sizeTier: "2br_2ba", frequency: "weekly", isPrepaidPackage: true, visitCount: 6 }),
      TEST_OVERRIDES // supplies=$15 flat, travel=0%
    );
    expect(result.discountProgram).toBe("prepaid_package");

    // Cleaning subtotal $149 -> weekly recurring (×0.79) -> package (×0.80).
    const cleaningSubtotal = 149;
    const afterRecurring = cleaningSubtotal * 0.79; // 117.71
    const afterPackage = afterRecurring * 0.8; // 94.168 (discounted cleaning-only, per visit)
    const perVisitTravel = 0;
    const perVisitSupplies = 15;

    // Per-visit effective price (unchanged meaning of calculatedTotal).
    expect(result.calculatedTotal).toBeCloseTo(afterPackage + perVisitTravel + perVisitSupplies);

    // Total for all 6 prepaid visits: discounted cleaning portion × 6, plus
    // undiscounted travel × 6, plus undiscounted supplies × 6 (no add-ons here).
    const expectedTotal = afterPackage * 6 + perVisitTravel * 6 + perVisitSupplies * 6;
    expect(result.prepaidPackageTotal).toBeCloseTo(expectedTotal);

    // The two numbers are consistent: total / visitCount === per-visit price.
    expect(result.prepaidPackageTotal! / result.visitCount).toBeCloseTo(result.calculatedTotal);
  });

  // -------------------------------------------------------------------------
  // Visit-specific add-ons (owner-approved 2026-08-13, milestone correction).
  // Add-ons belong to individual visits — never automatically once-per-
  // package, never automatically multiplied across every visit. `addOnIds`
  // (the flat single-request field) has no valid meaning for a package;
  // per-visit assignment comes from `visitAddOns` instead.
  // -------------------------------------------------------------------------

  it("the classic pricedAddOnsTotal/manualQuoteAddOns fields stay empty for a package — addOnIds is not used for package pricing", () => {
    const result = calculateEstimate(
      baseInput({
        sizeTier: "2br_2ba",
        frequency: "weekly",
        isPrepaidPackage: true,
        visitCount: 6,
        addOnIds: ["inside_oven"],
      }),
      TEST_OVERRIDES
    );
    expect(result.pricedAddOns).toEqual([]);
    expect(result.pricedAddOnsTotal).toBe(0);
    expect(result.manualQuoteAddOns).toEqual([]);
  });

  it("a stray addOnIds submission with no visit assignment is flagged for manual review, never guessed at", () => {
    const result = calculateEstimate(
      baseInput({
        sizeTier: "2br_2ba",
        frequency: "weekly",
        isPrepaidPackage: true,
        visitCount: 6,
        addOnIds: ["inside_oven"], // no visitAddOns provided
      }),
      TEST_OVERRIDES
    );
    expect(result.manualReviewReasons).toContain("ADD_ON_VISIT_ASSIGNMENT_REQUIRED");
    expect(result.manualReviewRequired).toBe(true);
    expect(result.packageAddOnsTotal).toBe(0);
  });

  it("an add-on selected on exactly one visit is counted once, not multiplied across all 6 visits", () => {
    const withoutAddOn = calculateEstimate(
      baseInput({ sizeTier: "2br_2ba", frequency: "weekly", isPrepaidPackage: true, visitCount: 6 }),
      TEST_OVERRIDES
    );
    const withAddOnOnOneVisit = calculateEstimate(
      baseInput({
        sizeTier: "2br_2ba",
        frequency: "weekly",
        isPrepaidPackage: true,
        visitCount: 6,
        visitAddOns: [["inside_oven"]], // Visit 1 only; visits 2-6 implicitly none
      }),
      TEST_OVERRIDES
    );
    expect(withAddOnOnOneVisit.packageAddOnsTotal).toBe(35); // once, not ×6 ($210)
    expect(withAddOnOnOneVisit.prepaidPackageTotal).toBeCloseTo(withoutAddOn.prepaidPackageTotal! + 35);
  });

  it("the same add-on selected on two different visits is counted twice", () => {
    const result = calculateEstimate(
      baseInput({
        sizeTier: "2br_2ba",
        frequency: "weekly",
        isPrepaidPackage: true,
        visitCount: 6,
        visitAddOns: [["inside_oven"], [], ["inside_oven"]], // Visit 1 and Visit 3
      }),
      TEST_OVERRIDES
    );
    expect(result.packageAddOnsTotal).toBe(70); // 2 × $35
  });

  it("a visit with no add-ons selected contributes exactly $0", () => {
    const result = calculateEstimate(
      baseInput({
        sizeTier: "2br_2ba",
        frequency: "weekly",
        isPrepaidPackage: true,
        visitCount: 6,
        visitAddOns: [["inside_oven"], [], [], [], [], []], // only Visit 1
      }),
      TEST_OVERRIDES
    );
    expect(result.packageAddOnsTotal).toBe(35);
  });

  it("owner worked example: Oven on Visit 1 + Fridge on Visit 3 + Oven & Fridge on Visit 5 totals $140, never discounted", () => {
    const withoutAddOns = calculateEstimate(
      baseInput({ sizeTier: "2br_2ba", frequency: "weekly", isPrepaidPackage: true, visitCount: 6 }),
      TEST_OVERRIDES
    );
    const result = calculateEstimate(
      baseInput({
        sizeTier: "2br_2ba",
        frequency: "weekly",
        isPrepaidPackage: true,
        visitCount: 6,
        visitAddOns: [
          ["inside_oven"], // Visit 1
          [], // Visit 2
          ["inside_refrigerator"], // Visit 3
          [], // Visit 4
          ["inside_oven", "inside_refrigerator"], // Visit 5
          [], // Visit 6
        ],
      }),
      TEST_OVERRIDES
    );
    expect(result.packageAddOnsTotal).toBe(140);
    // Base package ($700.01, see the dedicated rounding test below) + $140, undiscounted.
    expect(result.prepaidPackageTotal).toBeCloseTo(withoutAddOns.prepaidPackageTotal! + 140);
  });

  it("does not apply the recurring or package discount to add-ons", () => {
    const cleaningOnly = calculateEstimate(
      baseInput({ sizeTier: "2br_2ba", frequency: "weekly", isPrepaidPackage: true, visitCount: 6 }),
      TEST_OVERRIDES
    );
    const withAddOns = calculateEstimate(
      baseInput({
        sizeTier: "2br_2ba",
        frequency: "weekly",
        isPrepaidPackage: true,
        visitCount: 6,
        visitAddOns: [["inside_oven"]],
      }),
      TEST_OVERRIDES
    );
    // recurringAdjustment/packageDiscount (the cleaning-portion discounts) are identical either way —
    // the $35 add-on charge is added on top, full price, never reduced.
    expect(withAddOns.recurringAdjustment).toBeCloseTo(cleaningOnly.recurringAdjustment);
    expect(withAddOns.packageDiscount).toBeCloseTo(cleaningOnly.packageDiscount);
    expect(withAddOns.prepaidPackageTotal! - cleaningOnly.prepaidPackageTotal!).toBeCloseTo(35);
  });

  it("preserves manual-quote add-ons as price-to-be-confirmed, tagged with their visit number, never an invented price", () => {
    const result = calculateEstimate(
      baseInput({
        sizeTier: "2br_2ba",
        frequency: "weekly",
        isPrepaidPackage: true,
        visitCount: 6,
        visitAddOns: [["carpet_shampooing"], [], ["heavy_organization"]],
      }),
      TEST_OVERRIDES
    );
    expect(result.packageManualQuoteAddOns).toEqual([
      { id: "carpet_shampooing", label: "Carpet Shampooing", visitNumber: 1 },
      { id: "heavy_organization", label: "Heavy Organization", visitNumber: 3 },
    ]);
    expect(result.manualReviewRequired).toBe(true);
    expect(result.manualReviewReasons).toContain("MANUAL_QUOTE_ADD_ON_SELECTED");
    // Manual-quote add-ons don't block the rest of the instant package pricing.
    expect(result.estimateType).toBe("instant-range");
  });

  it("preserves 'starting at' add-ons at their approved starting amount for a package visit, never inflated to a guaranteed final price", () => {
    const result = calculateEstimate(
      baseInput({
        sizeTier: "2br_2ba",
        frequency: "weekly",
        isPrepaidPackage: true,
        visitCount: 6,
        visitAddOns: [["inside_cabinets_drawers"]], // approved starting-at $40
      }),
      TEST_OVERRIDES
    );
    expect(result.packageAddOnsTotal).toBe(40);
    // The numeric minimum is known, but the pricingKind must survive into the
    // package result — a caller must not treat prepaidPackageTotal as a
    // guaranteed final price just because a number is available.
    expect(result.hasStartingAtPricing).toBe(true);
    expect(result.packagePricedAddOns).toEqual([
      { id: "inside_cabinets_drawers", label: "Inside Cabinets & Drawers", amount: 40, pricingKind: "starting_at", visitNumber: 1 },
    ]);
  });

  // -------------------------------------------------------------------------
  // hasStartingAtPricing — semantic verification (owner-approved 2026-08-13):
  // a "starting at" add-on amount is a floor, not a promise, and must never
  // be silently presented as an authoritative guaranteed payable total.
  // -------------------------------------------------------------------------

  describe("starting-at pricing semantics", () => {
    it("1. a fixed add-on (Inside Oven) produces an exact total — hasStartingAtPricing stays false", () => {
      const result = calculateEstimate(
        baseInput({
          sizeTier: "2br_2ba",
          frequency: "weekly",
          isPrepaidPackage: true,
          visitCount: 6,
          visitAddOns: [["inside_oven"]],
        }),
        TEST_OVERRIDES
      );
      expect(result.packageAddOnsTotal).toBe(35);
      expect(result.hasStartingAtPricing).toBe(false);
      expect(result.packagePricedAddOns[0].pricingKind).toBe("fixed");
    });

    it("2. Inside Cabinets & Drawers (starting at $40) flags hasStartingAtPricing — the numeric total is a minimum, not a guarantee", () => {
      const result = calculateEstimate(
        baseInput({
          sizeTier: "2br_2ba",
          frequency: "weekly",
          isPrepaidPackage: true,
          visitCount: 6,
          visitAddOns: [["inside_cabinets_drawers"]],
        }),
        TEST_OVERRIDES
      );
      expect(result.packageAddOnsTotal).toBe(40);
      expect(result.hasStartingAtPricing).toBe(true);
      expect(result.packagePricedAddOns[0]).toMatchObject({ id: "inside_cabinets_drawers", pricingKind: "starting_at" });
    });

    it("3. Extra Pet Hair Removal (starting at $20) behaves the same way as Cabinets", () => {
      const result = calculateEstimate(
        baseInput({
          sizeTier: "2br_2ba",
          frequency: "weekly",
          isPrepaidPackage: true,
          visitCount: 6,
          visitAddOns: [["extra_pet_hair_removal"]],
        }),
        TEST_OVERRIDES
      );
      expect(result.packageAddOnsTotal).toBe(20);
      expect(result.hasStartingAtPricing).toBe(true);
      expect(result.packagePricedAddOns[0]).toMatchObject({ id: "extra_pet_hair_removal", pricingKind: "starting_at" });
    });

    it("4. a manual-quote add-on remains price-to-be-confirmed — never priced, never folded into hasStartingAtPricing's numeric total", () => {
      const result = calculateEstimate(
        baseInput({
          sizeTier: "2br_2ba",
          frequency: "weekly",
          isPrepaidPackage: true,
          visitCount: 6,
          visitAddOns: [["carpet_shampooing"]],
        }),
        TEST_OVERRIDES
      );
      expect(result.packageAddOnsTotal).toBe(0);
      expect(result.packagePricedAddOns).toEqual([]);
      expect(result.packageManualQuoteAddOns).toEqual([
        { id: "carpet_shampooing", label: "Carpet Shampooing", visitNumber: 1 },
      ]);
      expect(result.manualReviewRequired).toBe(true);
      expect(result.manualReviewReasons).toContain("MANUAL_QUOTE_ADD_ON_SELECTED");
      // A pure manual-quote selection contributes no priced amount, so it
      // doesn't itself set hasStartingAtPricing — its own price is entirely
      // unknown, which is a stronger, separately-flagged condition.
      expect(result.hasStartingAtPricing).toBe(false);
    });

    it("5. a fixed + starting-at combination on the same package preserves the starting-at flag", () => {
      const result = calculateEstimate(
        baseInput({
          sizeTier: "2br_2ba",
          frequency: "weekly",
          isPrepaidPackage: true,
          visitCount: 6,
          visitAddOns: [
            ["inside_oven"], // Visit 1: fixed $35
            [],
            ["inside_cabinets_drawers"], // Visit 3: starting-at $40
          ],
        }),
        TEST_OVERRIDES
      );
      expect(result.packageAddOnsTotal).toBe(75);
      expect(result.hasStartingAtPricing).toBe(true); // one starting-at entry is enough to taint the whole total
      const kinds = result.packagePricedAddOns.map((a) => a.pricingKind).sort();
      expect(kinds).toEqual(["fixed", "starting_at"]);
    });

    it("the classic (non-package) one-time flow also preserves the flag — a one-time quote with a starting-at add-on is not silently exact either", () => {
      const oneTimeFixed = calculateEstimate(baseInput({ addOnIds: ["inside_oven"] }), TEST_OVERRIDES);
      const oneTimeStartingAt = calculateEstimate(baseInput({ addOnIds: ["inside_cabinets_drawers"] }), TEST_OVERRIDES);
      expect(oneTimeFixed.hasStartingAtPricing).toBe(false);
      expect(oneTimeStartingAt.hasStartingAtPricing).toBe(true);
    });
  });

  it("visitCount is echoed on the result so per-visit and total figures can be cross-checked", () => {
    const result = calculateEstimate(
      baseInput({ sizeTier: "2br_2ba", frequency: "weekly", isPrepaidPackage: true, visitCount: 10 }),
      TEST_OVERRIDES
    );
    expect(result.visitCount).toBe(10);
    expect(result.prepaidPackageTotal! / 10).toBeCloseTo(result.calculatedTotal);
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
      zipTravelConfig: [{ zip: "99999", percentage: 0.08, band: "nearby" as TravelBand }],
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

  it("uses the real production square-footage table once square footage is supplied (1br_1ba: 1,200 sqft = 1 band over the 1,000 allowance = 1.05x)", () => {
    const result = calculateEstimate(baseInput({ squareFeet: 1200 }), TEST_OVERRIDES);
    expect(result.squareFootageConfigured).toBe(true);
    expect(result.squareFootageMultiplier).toBe(1.05);
    expect(result.estimateType).toBe("instant-range");
  });

  it("routes to manual review instead of silently defaulting to 1.00 when square footage is genuinely unconfigured", () => {
    const result = calculateEstimate(baseInput({ squareFeet: 1200 }), {
      ...TEST_OVERRIDES,
      squareFootageConfig: [],
    });
    expect(result.squareFootageConfigured).toBe(false);
    expect(result.estimateType).toBe("manual-review");
    expect(result.manualReviewReasons).toContain("SQUARE_FOOTAGE_NOT_CONFIGURED");
  });

  it("routes to manual review when actual square footage is beyond the configured limit, even in production (1br_1ba max is 2,500 sqft)", () => {
    const result = calculateEstimate(baseInput({ squareFeet: 2600 }), TEST_OVERRIDES);
    expect(result.squareFootageConfigured).toBe(false);
    expect(result.estimateType).toBe("manual-review");
    expect(result.manualReviewReasons).toContain("SQUARE_FOOTAGE_BEYOND_CONFIGURED_LIMIT");
  });

  it("skips room adjustments when actual rooms are not provided or fit the tier baseline", () => {
    const result = calculateEstimate(
      baseInput({ rooms: { bedrooms: 1, fullBathrooms: 1, halfBathrooms: 0 }, sizeTier: "1br_1ba" }),
      TEST_OVERRIDES
    );
    expect(result.roomAdjustmentConfigured).toBe(true);
    expect(result.roomAdjustments).toBe(0);
  });

  it("uses the real production room-adjustment table (Standard: +$20/bedroom) once extra rooms are reported", () => {
    const result = calculateEstimate(
      baseInput({ rooms: { bedrooms: 2, fullBathrooms: 1, halfBathrooms: 0 }, sizeTier: "1br_1ba" }),
      TEST_OVERRIDES
    );
    expect(result.roomAdjustmentConfigured).toBe(true);
    expect(result.roomAdjustments).toBe(20);
    expect(result.estimateType).toBe("instant-range");
  });

  it("routes to manual review when extra rooms are reported but genuinely unconfigured", () => {
    const unconfigured: RoomAdjustmentConfig = {
      standard: { additionalBedroomCharge: null, additionalFullBathroomCharge: null, additionalHalfBathroomCharge: null },
      deep: { additionalBedroomCharge: null, additionalFullBathroomCharge: null, additionalHalfBathroomCharge: null },
      move: { additionalBedroomCharge: null, additionalFullBathroomCharge: null, additionalHalfBathroomCharge: null },
    };
    const result = calculateEstimate(
      baseInput({ rooms: { bedrooms: 2, fullBathrooms: 1, halfBathrooms: 0 }, sizeTier: "1br_1ba" }),
      { ...TEST_OVERRIDES, roomAdjustmentConfig: unconfigured }
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
  it("uses the same base price and condition multiplier as Home — no special widening of the underlying calculation", () => {
    const home = calculateEstimate(
      baseInput({ propertyKind: "home", cleaningType: "standard", sizeTier: "2br_2ba", condition: "light" }),
      TEST_OVERRIDES
    );
    const airbnb = calculateEstimate(
      baseInput({ propertyKind: "airbnb", cleaningType: "standard", sizeTier: "2br_2ba", condition: "light" }),
      TEST_OVERRIDES
    );
    expect(airbnb.basePrice).toBe(home.basePrice);
    expect(airbnb.conditionMultiplier).toBe(home.conditionMultiplier);
    // Same range formula (percentage-vs-minimum-gap), applied to each one's
    // own calculatedTotal — totals legitimately differ because Airbnb uses
    // its own approved supplies rate (see below), not Standard's.
    expect(airbnb.range).not.toBeNull();
  });

  it("preserves uncertain Airbnb extras as manual-quote add-ons rather than widening the range", () => {
    const result = calculateEstimate(baseInput({ propertyKind: "airbnb", addOnIds: ["heavy_organization"] }), TEST_OVERRIDES);
    expect(result.manualQuoteAddOns).toEqual([{ id: "heavy_organization", label: "Heavy Organization" }]);
    expect(result.range).not.toBeNull();
  });

  it("an Airbnb booking uses the approved Airbnb supplies schedule, independent of its selected cleaning type", () => {
    // 1br_1ba's default effective sqft (1,000) -> Airbnb's own "up to 1,000" band ($15),
    // same figure as Standard's own band here, so also check a size where they diverge.
    const airbnbSmall = calculateEstimate(baseInput({ propertyKind: "airbnb", cleaningType: "standard" }), {
      zipTravelConfig: TEST_ZIP_NO_TRAVEL,
    });
    expect(airbnbSmall.suppliesEquipmentCharge).toBe(15);

    // 2br_2ba's default effective sqft (1,600) falls in the 1,001-2,200 band:
    // Airbnb = $20, Standard = $22.50, Deep = $30 — genuinely different rates.
    const home = calculateEstimate(baseInput({ propertyKind: "home", cleaningType: "standard", sizeTier: "2br_2ba" }), {
      zipTravelConfig: TEST_ZIP_NO_TRAVEL,
    });
    const airbnb = calculateEstimate(baseInput({ propertyKind: "airbnb", cleaningType: "standard", sizeTier: "2br_2ba" }), {
      zipTravelConfig: TEST_ZIP_NO_TRAVEL,
    });
    expect(home.suppliesEquipmentCharge).toBe(22.5);
    expect(airbnb.suppliesEquipmentCharge).toBe(20);
    expect(airbnb.suppliesEquipmentCharge).not.toBe(home.suppliesEquipmentCharge);

    // The Airbnb rate applies regardless of which cleaning type is selected.
    const airbnbDeep = calculateEstimate(baseInput({ propertyKind: "airbnb", cleaningType: "deep", sizeTier: "2br_2ba" }), {
      zipTravelConfig: TEST_ZIP_NO_TRAVEL,
    });
    expect(airbnbDeep.suppliesEquipmentCharge).toBe(20);
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
