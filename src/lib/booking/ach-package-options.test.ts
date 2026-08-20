import { describe, expect, it } from "vitest";
import { buildAchPackageOptions } from "./ach-package-options";
import type { BookingPricingOptions } from "./types";

// buildAchPackageOptions only ever reads .prepaidPackageTotal and
// .visitCount off each package result — a minimal fake is sufficient and
// keeps this test decoupled from the full CalculationResult shape.
function fakePackages(overrides: {
  weekly?: number | null;
  biweekly?: number | null;
  every_4_weeks?: number | null;
}): BookingPricingOptions["packages"] {
  function entry(prepaidPackageTotal: number | null | undefined) {
    return { prepaidPackageTotal: prepaidPackageTotal ?? null, visitCount: 6 };
  }
  return {
    weekly: entry(overrides.weekly),
    biweekly: entry(overrides.biweekly),
    every_4_weeks: entry(overrides.every_4_weeks),
  } as unknown as BookingPricingOptions["packages"];
}

describe("buildAchPackageOptions", () => {
  it("computes the ACH-discounted subtotal, savings, and per-visit price for every buyable package frequency", () => {
    const packages = fakePackages({ weekly: 770.63, biweekly: 900, every_4_weeks: 1048.37 });
    const result = buildAchPackageOptions(packages);

    // 770.63 * 0.99 = 762.9237 -> 762.92; savings 7.71; per-visit 127.15333.. -> 127.15
    expect(result.weekly).toEqual({
      achSubtotal: 762.92,
      achSavingsAmount: 7.71,
      achEffectivePricePerVisit: 127.15,
    });

    // 900 * 0.99 = 891; savings 9; per-visit 148.5
    expect(result.biweekly).toEqual({
      achSubtotal: 891,
      achSavingsAmount: 9,
      achEffectivePricePerVisit: 148.5,
    });
  });

  it("is strictly less than the card subtotal for every buyable frequency", () => {
    const cardTotals = { weekly: 770.63, biweekly: 900, every_4_weeks: 1048.37 };
    const packages = fakePackages(cardTotals);
    const ach = buildAchPackageOptions(packages);
    for (const frequency of ["weekly", "biweekly", "every_4_weeks"] as const) {
      expect(ach[frequency]!.achSubtotal).toBeLessThan(cardTotals[frequency]);
    }
  });

  it("returns null for a frequency with no card subtotal (manual review), never inventing a discounted amount", () => {
    const packages = fakePackages({ weekly: 770.63, biweekly: null, every_4_weeks: 1048.37 });
    const result = buildAchPackageOptions(packages);
    expect(result.biweekly).toBeNull();
    expect(result.weekly).not.toBeNull();
  });
});
