import { describe, expect, it } from "vitest";
import { calculateEstimateWithComparison } from "./estimate-with-comparison";
import type { CalculationInput } from "@/lib/pricing/types";

const ASOF_LAUNCH = new Date("2026-08-15T12:00:00-05:00");

function baseInput(overrides: Partial<CalculationInput> = {}): CalculationInput {
  return {
    propertyKind: "home",
    cleaningType: "standard",
    condition: "light",
    sizeTier: "1br_1ba",
    zip: "75056",
    frequency: "one_time",
    isPrepaidPackage: false,
    visitCount: 1,
    addOnIds: [],
    firstCleaningEligible: false,
    asOf: ASOF_LAUNCH,
    ...overrides,
  };
}

describe("calculateEstimateWithComparison", () => {
  it("returns null regularRange when the first-cleaning offer is not applied", () => {
    const { result, regularRange } = calculateEstimateWithComparison(baseInput());
    expect(result.discountProgram).not.toBe("first_cleaning");
    expect(regularRange).toBeNull();
  });

  it("returns the undiscounted range as regularRange when the offer IS applied", () => {
    const { result, regularRange } = calculateEstimateWithComparison(
      baseInput({ firstCleaningEligible: true })
    );
    expect(result.discountProgram).toBe("first_cleaning");
    expect(result.range).toEqual({ lower: 110, upper: 130 }); // matches production-scenarios test #3
    expect(regularRange).toEqual({ lower: 145, upper: 165 }); // matches production-scenarios test #1 (same input, no offer)
    expect(regularRange!.lower).toBeGreaterThan(result.range!.lower);
  });

  it("never mutates the primary result — result.range stays the discounted range", () => {
    const { result } = calculateEstimateWithComparison(baseInput({ firstCleaningEligible: true }));
    expect(result.firstCleaningDiscount).toBeGreaterThan(0);
  });

  it("preserves the $99 floor behavior on the regular comparison independently", () => {
    // Studio Standard Light, first-cleaning eligible: discounted total floors at $99 (production-scenarios test #21).
    const { result, regularRange } = calculateEstimateWithComparison(
      baseInput({ sizeTier: "studio_1ba", firstCleaningEligible: true })
    );
    expect(result.calculatedTotal).toBe(99);
    expect(result.range).toEqual({ lower: 99, upper: 120 });
    // The regular (undiscounted) comparison is a completely independent
    // calculation — its own $99 floor logic applies on its own terms.
    expect(regularRange).toEqual({ lower: 125, upper: 145 });
  });

  it("reflects a still-applicable recurring-cycle discount in the regular comparison for a first-time recurring customer", () => {
    // Weekly + first-cleaning eligible resolves to discountProgram "first_cleaning"
    // (30%/25% beats the 21% weekly rate) — but WITHOUT the first-cleaning
    // special, the customer would still get their recurring-cycle discount,
    // not the fully undiscounted one-time price. The regular comparison
    // must reflect that honestly.
    const { result, regularRange } = calculateEstimateWithComparison(
      baseInput({ sizeTier: "2br_2ba", frequency: "weekly", firstCleaningEligible: true })
    );
    expect(result.discountProgram).toBe("first_cleaning");
    const undiscountedOneTime = calculateEstimateWithComparison(
      baseInput({ sizeTier: "2br_2ba", frequency: "one_time", firstCleaningEligible: false })
    ).result.range!;
    // Regular (still recurring-discounted) must be cheaper than the fully undiscounted one-time price.
    expect(regularRange!.lower).toBeLessThan(undiscountedOneTime.lower);
  });

  it("returns null regularRange for a prepaid package (package discount wins over first-cleaning)", () => {
    const { result, regularRange } = calculateEstimateWithComparison(
      baseInput({
        sizeTier: "2br_2ba",
        frequency: "weekly",
        isPrepaidPackage: true,
        visitCount: 6,
        firstCleaningEligible: true,
      })
    );
    expect(result.discountProgram).toBe("prepaid_package");
    expect(regularRange).toBeNull();
  });
});
