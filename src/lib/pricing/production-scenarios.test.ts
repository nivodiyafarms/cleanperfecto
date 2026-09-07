// Representative end-to-end quote calculations using the REAL production
// configuration (no test-fixture overrides) — owner-approved 2026-08-13
// finalized pricing milestone, item 17. These exercise the actual deployed
// ZIP travel table, supplies/equipment table, square-footage table, and
// room-adjustment table together, as a production customer's quote would.
import { describe, expect, it } from "vitest";
import { calculateEstimate } from "./calculate-estimate";
import type { CalculationInput } from "./types";

const ASOF_LAUNCH = new Date("2026-08-15T12:00:00-05:00"); // within the 30%-off launch window

function baseInput(overrides: Partial<CalculationInput> = {}): CalculationInput {
  return {
    propertyKind: "home",
    cleaningType: "standard",
    condition: "light",
    sizeTier: "1br_1ba",
    zip: "75056", // Core / 0% — CleanPerfecto's own base ZIP
    frequency: "one_time",
    isPrepaidPackage: false,
    visitCount: 1,
    addOnIds: [],
    firstCleaningEligible: false,
    asOf: ASOF_LAUNCH,
    ...overrides,
  };
}

describe("1. 1B1B Standard Light", () => {
  it("calculates $144 total, $145-$165 displayed range", () => {
    const result = calculateEstimate(baseInput());
    expect(result.estimateType).toBe("instant-range");
    expect(result.basePrice).toBe(129);
    expect(result.suppliesEquipmentCharge).toBe(15); // 1,000 sqft default -> "up to 1,000" Standard band
    expect(result.travelCharge).toBe(0);
    expect(result.calculatedTotal).toBe(144);
    expect(result.range).toEqual({ lower: 145, upper: 165 });
  });
});

describe("2. 1B1B Standard Moderate", () => {
  it("same $144 total as Light (Moderate multiplier is also 1.00 for Standard), wider range", () => {
    const result = calculateEstimate(baseInput({ condition: "moderate" }));
    expect(result.calculatedTotal).toBe(144);
    expect(result.range).toEqual({ lower: 145, upper: 170 });
  });
});

describe("3. 1B1B eligible first cleaning", () => {
  it("applies the 30% launch offer to the cleaning-service portion only", () => {
    const result = calculateEstimate(baseInput({ firstCleaningEligible: true }));
    expect(result.discountProgram).toBe("first_cleaning");
    expect(result.activeFirstCleaningOfferPercent).toBe(30);
    expect(result.firstCleaningDiscount).toBeCloseTo(38.7);
    expect(result.calculatedTotal).toBeCloseTo(105.3);
    expect(result.range).toEqual({ lower: 110, upper: 130 });
  });
});

describe("4. 3B2B Standard", () => {
  it("calculates $201.50 total with no room adjustment", () => {
    const result = calculateEstimate(baseInput({ sizeTier: "3br_2ba" }));
    expect(result.basePrice).toBe(179);
    expect(result.roomAdjustments).toBe(0);
    expect(result.suppliesEquipmentCharge).toBe(22.5); // 2,200 sqft default -> 1,001-2,200 Standard band
    expect(result.calculatedTotal).toBeCloseTo(201.5);
    expect(result.range).toEqual({ lower: 205, upper: 225 });
  });
});

describe("5. 3B3B Standard with one extra full bathroom", () => {
  it("charges exactly one +$25 full-bath adjustment", () => {
    const result = calculateEstimate(
      baseInput({ sizeTier: "3br_2ba", rooms: { bedrooms: 3, fullBathrooms: 3, halfBathrooms: 0 } })
    );
    expect(result.roomAdjustments).toBe(25);
    expect(result.basePrice + result.roomAdjustments).toBe(204); // owner worked example
    expect(result.calculatedTotal).toBeCloseTo(226.5);
    expect(result.range).toEqual({ lower: 230, upper: 250 });
  });
});

describe("6. 3B2.5B Standard with one half bathroom", () => {
  it("charges exactly one +$12.50 half-bath adjustment", () => {
    const result = calculateEstimate(
      baseInput({ sizeTier: "3br_2ba", rooms: { bedrooms: 3, fullBathrooms: 2, halfBathrooms: 1 } })
    );
    expect(result.roomAdjustments).toBe(12.5);
    expect(result.calculatedTotal).toBeCloseTo(214);
    expect(result.range).toEqual({ lower: 215, upper: 235 });
  });
});

describe("7. 3B2B Standard Heavy", () => {
  it("applies the ×1.15 Heavy multiplier and recommends Deep", () => {
    const result = calculateEstimate(baseInput({ sizeTier: "3br_2ba", condition: "heavy" }));
    expect(result.conditionMultiplier).toBe(1.15);
    expect(result.recommendedService).toBe("deep");
    expect(result.calculatedTotal).toBeCloseTo(228.35);
    expect(result.range).toEqual({ lower: 230, upper: 260 });
  });
});

describe("8. 3B2B Deep Heavy", () => {
  it("uses the Deep base price, Deep supplies band, and ×1.15 multiplier", () => {
    const result = calculateEstimate(baseInput({ cleaningType: "deep", sizeTier: "3br_2ba", condition: "heavy" }));
    expect(result.basePrice).toBe(279);
    expect(result.suppliesEquipmentCharge).toBe(30); // Deep, 1,001-2,200 band
    expect(result.calculatedTotal).toBeCloseTo(350.85);
    expect(result.range).toEqual({ lower: 355, upper: 390 });
  });
});

describe("9. 4B3B Deep", () => {
  it("4 bedrooms / 3 full baths matches the 4br_plus baseline exactly — no room adjustment", () => {
    const result = calculateEstimate(
      baseInput({
        cleaningType: "deep",
        sizeTier: "4br_plus",
        rooms: { bedrooms: 4, fullBathrooms: 3, halfBathrooms: 0 },
      })
    );
    expect(result.roomAdjustments).toBe(0);
    expect(result.basePrice).toBe(329);
    expect(result.suppliesEquipmentCharge).toBe(35); // Deep, 2,201-3,000 band
    expect(result.calculatedTotal).toBeCloseTo(364);
    expect(result.range).toEqual({ lower: 365, upper: 385 });
  });
});

describe("10. 5B3B Standard", () => {
  it("charges exactly one +$20 extra-bedroom adjustment over the 4B base tier", () => {
    const result = calculateEstimate(
      baseInput({
        sizeTier: "4br_plus",
        rooms: { bedrooms: 5, fullBathrooms: 3, halfBathrooms: 0 },
      })
    );
    expect(result.roomAdjustments).toBe(20);
    expect(result.calculatedTotal).toBeCloseTo(256.5);
    expect(result.range).toEqual({ lower: 260, upper: 280 });
  });
});

describe("11-13. Recurring cycles (2B2B Standard Light, not first-cleaning-eligible)", () => {
  it("11. Weekly reduces the cleaning-service portion by 21%", () => {
    const result = calculateEstimate(baseInput({ sizeTier: "2br_2ba", frequency: "weekly" }));
    expect(result.discountProgram).toBe("recurring_cycle");
    expect(result.recurringAdjustment).toBeCloseTo(31.29);
    expect(result.calculatedTotal).toBeCloseTo(140.21);
    expect(result.range).toEqual({ lower: 145, upper: 165 });
  });

  it("12. Biweekly reduces the cleaning-service portion by 14%", () => {
    const result = calculateEstimate(baseInput({ sizeTier: "2br_2ba", frequency: "biweekly" }));
    expect(result.discountProgram).toBe("recurring_cycle");
    expect(result.recurringAdjustment).toBeCloseTo(20.86);
    expect(result.calculatedTotal).toBeCloseTo(150.64);
    expect(result.range).toEqual({ lower: 155, upper: 175 });
  });

  it("13. Monthly (every 4 weeks) reduces the cleaning-service portion by 7%", () => {
    const result = calculateEstimate(baseInput({ sizeTier: "2br_2ba", frequency: "every_4_weeks" }));
    expect(result.discountProgram).toBe("recurring_cycle");
    expect(result.recurringAdjustment).toBeCloseTo(10.43);
    expect(result.calculatedTotal).toBeCloseTo(161.07);
    expect(result.range).toEqual({ lower: 165, upper: 185 });
  });
});

describe("14. 6+ prepaid weekly package (2B2B Standard Light)", () => {
  it("applies the sequential 21% recurring + 10% package discount (not additive) and reports the authoritative payable total in exact USD cents", () => {
    const result = calculateEstimate(
      baseInput({ sizeTier: "2br_2ba", frequency: "weekly", isPrepaidPackage: true, visitCount: 6 })
    );
    expect(result.discountProgram).toBe("prepaid_package");

    // --- Calculation components (finalized 2026-08-31: 10% package discount, was 20%) ---
    // Cleaning subtotal $149 -> weekly recurring (x0.79) -> package (x0.90):
    //   149 x 0.79 x 6 x 0.90 = 635.634
    // Supplies: 22.50 x 6 = $135.00. Travel: $0. Total: 635.634 + 135.00 = 770.634 -> rounded once: $770.63.
    expect(result.recurringAdjustment).toBeCloseTo(31.29); // 149 - (149*0.79)
    expect(result.packageDiscount).toBeCloseTo(11.771); // (149*0.79) - (149*0.79*0.9)

    expect(result.visitCount).toBe(6);

    // --- Authoritative payable amounts, rounded to the cent — never raw
    // floats like 770.634 or 128.438333 in customer/payment-facing output ---
    expect(result.prepaidPackageTotal).toBe(770.63);
    expect(result.effectivePricePerVisit).toBe(128.44); // 770.63 / 6 = 128.43833... -> 128.44
    expect(Number.isInteger(result.prepaidPackageTotal! * 100)).toBe(true);
    expect(Number.isInteger(result.effectivePricePerVisit! * 100)).toBe(true);

    expect(result.range).toEqual({ lower: 130, upper: 150 }); // range is built around the per-visit price
  });

  it("owner worked example: visit-specific add-ons (Oven on Visit 1, Fridge on Visit 3, Oven+Fridge on Visit 5) add exactly $130, undiscounted, for a $900.63 package total", () => {
    const result = calculateEstimate(
      baseInput({
        sizeTier: "2br_2ba",
        frequency: "weekly",
        isPrepaidPackage: true,
        visitCount: 6,
        visitAddOns: [
          ["inside_oven"], // Visit 1: +$30
          [], // Visit 2
          ["inside_refrigerator"], // Visit 3: +$35
          [], // Visit 4
          ["inside_oven", "inside_refrigerator"], // Visit 5: +$65
          [], // Visit 6
        ],
      })
    );
    expect(result.packageAddOnsTotal).toBe(130);
    expect(result.prepaidPackageTotal).toBe(900.63);
    expect(Number.isInteger(result.prepaidPackageTotal! * 100)).toBe(true);
  });

  // ---------------------------------------------------------------------
  // Starting-at semantic verification (owner-approved 2026-08-13): a
  // "starting at" add-on must never be silently promoted into an exact,
  // guaranteed payable total just because a minimum dollar figure exists.
  // ---------------------------------------------------------------------

  it("$770.63 base + Visit 1 Oven Interior ($30, fixed) = exact $800.63, hasStartingAtPricing false", () => {
    const base = calculateEstimate(
      baseInput({ sizeTier: "2br_2ba", frequency: "weekly", isPrepaidPackage: true, visitCount: 6 })
    );
    const result = calculateEstimate(
      baseInput({
        sizeTier: "2br_2ba",
        frequency: "weekly",
        isPrepaidPackage: true,
        visitCount: 6,
        visitAddOns: [["inside_oven"]],
      })
    );
    expect(base.prepaidPackageTotal).toBe(770.63);
    expect(result.prepaidPackageTotal).toBe(800.63);
    expect(result.hasStartingAtPricing).toBe(false); // safe to present as an exact, final total
  });

  it("$770.63 base + Visit 2 Inside Cabinets & Drawers (starting at $40) = numeric $810.63, but flagged as a non-final estimate", () => {
    const result = calculateEstimate(
      baseInput({
        sizeTier: "2br_2ba",
        frequency: "weekly",
        isPrepaidPackage: true,
        visitCount: 6,
        visitAddOns: [[], ["inside_cabinets_drawers"]], // Visit 2
      })
    );
    expect(result.prepaidPackageTotal).toBe(810.63); // the numeric minimum
    expect(result.hasStartingAtPricing).toBe(true); // must be presented as "starting at" / requires confirmation, never as final
  });

  it("Extra Pet Hair Removal (starting at $20) behaves the same way as Cabinets — flagged, not exact", () => {
    const result = calculateEstimate(
      baseInput({
        sizeTier: "2br_2ba",
        frequency: "weekly",
        isPrepaidPackage: true,
        visitCount: 6,
        visitAddOns: [[], [], ["extra_pet_hair_removal"]], // Visit 3
      })
    );
    expect(result.prepaidPackageTotal).toBe(790.63); // 770.63 + 20
    expect(result.hasStartingAtPricing).toBe(true);
  });
});

describe("15-18. ZIP travel bands (1B1B Standard Light)", () => {
  it("15. Core ZIP (75056, the base ZIP) applies 0% travel", () => {
    const result = calculateEstimate(baseInput({ zip: "75056" }));
    expect(result.travelPercentage).toBe(0);
    expect(result.travelCharge).toBe(0);
    expect(result.calculatedTotal).toBe(144);
  });

  it("16. Nearby ZIP (75001) applies 3% travel", () => {
    const result = calculateEstimate(baseInput({ zip: "75001" }));
    expect(result.travelPercentage).toBe(0.03);
    expect(result.travelCharge).toBeCloseTo(3.87);
    expect(result.calculatedTotal).toBeCloseTo(147.87);
    expect(result.range).toEqual({ lower: 150, upper: 170 });
  });

  it("17. Extended ZIP (75002) applies 6% travel", () => {
    const result = calculateEstimate(baseInput({ zip: "75002" }));
    expect(result.travelPercentage).toBe(0.06);
    expect(result.travelCharge).toBeCloseTo(7.74);
    expect(result.calculatedTotal).toBeCloseTo(151.74);
    expect(result.range).toEqual({ lower: 155, upper: 175 });
  });

  it("18. Outer ZIP (75032, 37.8 mi per the approved CSV) applies 10% travel", () => {
    const result = calculateEstimate(baseInput({ zip: "75032" }));
    expect(result.travelPercentage).toBe(0.1);
    expect(result.travelCharge).toBeCloseTo(12.9);
    expect(result.calculatedTotal).toBeCloseTo(156.9);
    expect(result.range).toEqual({ lower: 160, upper: 180 });
  });

  it("19. Manual-review ZIP (75054, 40.7 mi per the approved CSV) — a known DFW ZIP explicitly assigned Manual review, no invented percentage", () => {
    const result = calculateEstimate(baseInput({ zip: "75054" }));
    expect(result.estimateType).toBe("manual-review");
    expect(result.manualReviewReasons).toContain("ZIP_MANUAL_REVIEW_REQUIRED");
    expect(result.manualReviewReasons).not.toContain("ZIP_TRAVEL_NOT_CONFIGURED");
    expect(result.range).toBeNull();
  });

  it("20. Unknown ZIP (never present in the approved CSV at all) requires manual review — a distinct reason from a known Manual-review ZIP", () => {
    const result = calculateEstimate(baseInput({ zip: "00000" }));
    expect(result.estimateType).toBe("manual-review");
    expect(result.manualReviewReasons).toContain("ZIP_TRAVEL_NOT_CONFIGURED");
    expect(result.manualReviewReasons).not.toContain("ZIP_MANUAL_REVIEW_REQUIRED");
  });
});

describe("21. $99 first-cleaning-floor scenario (Studio Standard Light)", () => {
  it("caps the discount so the total lands exactly at $99, range preserves $99 as the lower bound", () => {
    const result = calculateEstimate(baseInput({ sizeTier: "studio_1ba", firstCleaningEligible: true }));
    expect(result.basePrice).toBe(109);
    expect(result.suppliesEquipmentCharge).toBe(15); // 750 sqft default -> "up to 1,000" Standard band
    expect(result.preDiscountTotal).toBe(124);
    expect(result.minimumServiceTotalApplied).toBe(true);
    expect(result.calculatedTotal).toBe(99);
    expect(result.range).toEqual({ lower: 99, upper: 120 });
  });
});

describe("22. Large Heavy job — percentage-based range exceeds the $30 minimum gap", () => {
  it("4B+ Deep Heavy with extra rooms produces a spread well over $30", () => {
    const result = calculateEstimate(
      baseInput({
        cleaningType: "deep",
        sizeTier: "4br_plus",
        condition: "heavy",
        rooms: { bedrooms: 6, fullBathrooms: 4, halfBathrooms: 0 },
      })
    );
    expect(result.roomAdjustments).toBe(80); // 2 extra bedrooms (+$25 ea) + 1 extra full bath (+$30), Deep rates
    expect(result.calculatedTotal).toBeCloseTo(505.35);
    expect(result.range).toEqual({ lower: 510, upper: 560 });
    const spread = result.range!.upper - result.range!.lower;
    expect(spread).toBeGreaterThan(30);
    expect(result.calculatedTotal * 0.1).toBeGreaterThan(30); // percentage spread, not the $30 floor, drives this
  });
});
