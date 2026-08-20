import { describe, expect, it } from "vitest";
import { buildBookingPricingOptions } from "./build-booking-pricing-options";
import type { CalculationInput } from "@/lib/pricing/types";

// Uses the REAL production pricing config (no overrides) — this module's
// job is to wire calculateEstimate() correctly for every booking option,
// not to re-test the engine's own math (see src/lib/pricing/*.test.ts for
// that). 75056 is CleanPerfecto's own base ZIP (Core / 0% travel), always
// present in the approved production ZIP table.
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

describe("buildBookingPricingOptions", () => {
  it("computes all 4 normal frequency options with visitCount 1 and no package discount", () => {
    const { normal } = buildBookingPricingOptions({
      baseInput: baseInput(),
      firstCleaningEligible: false,
      addOnIds: [],
      asOf: new Date("2026-09-15T12:00:00-05:00"),
    });

    for (const frequency of ["one_time", "weekly", "biweekly", "every_4_weeks"] as const) {
      const result = normal[frequency];
      expect(result.frequency).toBe(frequency);
      expect(result.visitCount).toBe(1);
      expect(result.discountProgram).not.toBe("prepaid_package");
      expect(result.prepaidPackageTotal).toBeNull();
      expect(result.effectivePricePerVisit).toBeNull();
      expect(result.calculatedTotal).toBeGreaterThan(0);
    }
  });

  it("computes all 3 package frequencies with visitCount 6, isPrepaidPackage true, and a real prepaidPackageTotal", () => {
    const { packages } = buildBookingPricingOptions({
      baseInput: baseInput(),
      firstCleaningEligible: false,
      addOnIds: [],
      asOf: new Date("2026-09-15T12:00:00-05:00"),
    });

    for (const frequency of ["weekly", "biweekly", "every_4_weeks"] as const) {
      const result = packages[frequency];
      expect(result.frequency).toBe(frequency);
      expect(result.visitCount).toBe(6);
      expect(result.discountProgram).toBe("prepaid_package");
      expect(result.prepaidPackageTotal).not.toBeNull();
      expect(result.effectivePricePerVisit).not.toBeNull();
      // effectivePricePerVisit is a cent-rounded AVERAGE (prepaidPackageTotal
      // / visitCount), not a literal per-visit price — multiplying it back
      // out can differ from prepaidPackageTotal by a few cents once
      // rounding compounds across 6 visits. This just checks the two stay
      // in the same ballpark, not exact equality (the engine's own tests
      // cover its rounding rules).
      expect(result.prepaidPackageTotal as number).toBeCloseTo(
        (result.effectivePricePerVisit as number) * 6,
        0
      );
    }
  });

  it("never stacks the first-cleaning offer onto a prepaid package, even when the customer is first-cleaning eligible", () => {
    const { packages } = buildBookingPricingOptions({
      baseInput: baseInput(),
      firstCleaningEligible: true,
      addOnIds: [],
      asOf: new Date("2026-09-15T12:00:00-05:00"),
    });

    for (const frequency of ["weekly", "biweekly", "every_4_weeks"] as const) {
      expect(packages[frequency].discountProgram).toBe("prepaid_package");
      expect(packages[frequency].activeFirstCleaningOfferPercent === null || packages[frequency].discountProgram !== "first_cleaning").toBe(
        true
      );
      expect(packages[frequency].firstCleaningDiscount).toBe(0);
    }
  });

  it("computes futureRecurring for the 3 recurring frequencies only, with firstCleaningEligible forced false regardless of actual eligibility", () => {
    const { futureRecurring } = buildBookingPricingOptions({
      baseInput: baseInput(),
      firstCleaningEligible: true, // actual eligibility is true — future pricing must ignore this
      addOnIds: [],
      asOf: new Date("2026-09-15T12:00:00-05:00"),
    });

    expect(Object.keys(futureRecurring).sort()).toEqual(["biweekly", "every_4_weeks", "weekly"]);
    for (const frequency of ["weekly", "biweekly", "every_4_weeks"] as const) {
      const result = futureRecurring[frequency];
      expect(result.frequency).toBe(frequency);
      expect(result.visitCount).toBe(1);
      expect(result.discountProgram).not.toBe("first_cleaning");
    }
  });

  it("futureRecurring never has a lower price than it should just because the customer is first-cleaning eligible — it matches the ineligible-customer normal price for the same frequency", () => {
    const eligible = buildBookingPricingOptions({
      baseInput: baseInput(),
      firstCleaningEligible: true,
      addOnIds: [],
      asOf: new Date("2026-09-15T12:00:00-05:00"),
    });
    const ineligible = buildBookingPricingOptions({
      baseInput: baseInput(),
      firstCleaningEligible: false,
      addOnIds: [],
      asOf: new Date("2026-09-15T12:00:00-05:00"),
    });

    for (const frequency of ["weekly", "biweekly", "every_4_weeks"] as const) {
      expect(eligible.futureRecurring[frequency].calculatedTotal).toBeCloseTo(
        ineligible.normal[frequency].calculatedTotal
      );
    }
  });

  it("applies extra add-ons to normal options but never to package options", () => {
    const { normal, packages } = buildBookingPricingOptions({
      baseInput: baseInput(),
      firstCleaningEligible: false,
      addOnIds: ["inside_oven"],
      asOf: new Date("2026-09-15T12:00:00-05:00"),
    });

    expect(normal.one_time.pricedAddOns.some((addOn) => addOn.id === "inside_oven")).toBe(true);
    for (const frequency of ["weekly", "biweekly", "every_4_weeks"] as const) {
      expect(packages[frequency].pricedAddOns).toHaveLength(0);
      expect(packages[frequency].packageAddOnsTotal).toBe(0);
    }
  });
});
