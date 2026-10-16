import { describe, expect, it } from "vitest";
import type { CalculationInput } from "@/lib/pricing/types";
import { MANUAL_PRICING_VERSION, buildManualPricingSnapshot } from "./build-manual-pricing-snapshot";

function baseInput(overrides: Partial<CalculationInput> = {}): CalculationInput {
  return {
    propertyKind: "home",
    cleaningType: "standard",
    condition: "moderate",
    sizeTier: "2br_2ba",
    zip: "75056",
    frequency: "one_time",
    isPrepaidPackage: false,
    visitCount: 1,
    addOnIds: [],
    firstCleaningEligible: false,
    asOf: new Date("2026-10-16T00:00:00Z"),
    ...overrides,
  };
}

describe("buildManualPricingSnapshot", () => {
  it("satisfies getQuoteForBooking's bookability invariants", () => {
    const result = buildManualPricingSnapshot({
      calculationInput: baseInput(),
      agreedTotal: 250,
      scopeAddOnIds: [],
      asOf: new Date("2026-10-16T00:00:00Z"),
    });

    expect(result.estimateType).toBe("instant-range");
    expect(result.manualReviewRequired).toBe(false);
    expect(result.manualReviewReasons).toEqual([]);
  });

  it("collapses every line item into one sum equal to the agreed total", () => {
    const result = buildManualPricingSnapshot({
      calculationInput: baseInput(),
      agreedTotal: 312.5,
      scopeAddOnIds: [],
      asOf: new Date("2026-10-16T00:00:00Z"),
    });

    expect(result.calculatedTotal).toBe(312.5);
    expect(result.preDiscountTotal).toBe(312.5);
    expect(result.basePrice).toBe(312.5);
    expect(result.cleaningSubtotal).toBe(312.5);
    expect(result.range).toEqual({ lower: 312.5, upper: 312.5 });
    expect(result.roomAdjustments).toBe(0);
    expect(result.travelCharge).toBe(0);
    expect(result.suppliesEquipmentCharge).toBe(0);
    expect(result.hasStartingAtPricing).toBe(false);
    expect(result.discountProgram).toBe("none");
  });

  it("rounds the agreed total to the cent", () => {
    const result = buildManualPricingSnapshot({
      calculationInput: baseInput(),
      agreedTotal: 100.009,
      scopeAddOnIds: [],
      asOf: new Date(),
    });
    expect(result.calculatedTotal).toBe(100.01);
  });

  it("tags the pricing version distinctly from the real engine's version", () => {
    const result = buildManualPricingSnapshot({
      calculationInput: baseInput(),
      agreedTotal: 100,
      scopeAddOnIds: [],
      asOf: new Date(),
    });
    expect(result.pricingVersion).toBe(MANUAL_PRICING_VERSION);
    expect(result.pricingVersion).not.toBe("pricing-engine-2026-08");
  });

  it("populates prepaidPackageTotal/effectivePricePerVisit only for a prepaid package", () => {
    const oneTime = buildManualPricingSnapshot({
      calculationInput: baseInput(),
      agreedTotal: 100,
      scopeAddOnIds: [],
      asOf: new Date(),
    });
    expect(oneTime.prepaidPackageTotal).toBeNull();
    expect(oneTime.effectivePricePerVisit).toBeNull();

    const pkg = buildManualPricingSnapshot({
      calculationInput: baseInput({ isPrepaidPackage: true, visitCount: 6, frequency: "weekly" }),
      agreedTotal: 600,
      scopeAddOnIds: [],
      asOf: new Date(),
    });
    expect(pkg.prepaidPackageTotal).toBe(600);
    expect(pkg.effectivePricePerVisit).toBe(100);
    expect(pkg.calculatedTotal).toBe(600);
  });

  it("records scope add-ons as informational manualQuoteAddOns, never individually priced", () => {
    const result = buildManualPricingSnapshot({
      calculationInput: baseInput(),
      agreedTotal: 250,
      scopeAddOnIds: ["inside_oven", "inside_refrigerator"],
      asOf: new Date(),
    });
    expect(result.manualQuoteAddOns).toEqual([
      { id: "inside_oven", label: "Oven Interior" },
      { id: "inside_refrigerator", label: "Refrigerator Interior" },
    ]);
    expect(result.pricedAddOns).toEqual([]);
    expect(result.pricedAddOnsTotal).toBe(0);
    // Add-ons never change the agreed total — they're part of the already-negotiated scope.
    expect(result.calculatedTotal).toBe(250);
  });

  it("routes scope add-ons to packageManualQuoteAddOns instead for a prepaid package", () => {
    const result = buildManualPricingSnapshot({
      calculationInput: baseInput({ isPrepaidPackage: true, visitCount: 6, frequency: "weekly" }),
      agreedTotal: 600,
      scopeAddOnIds: ["inside_oven"],
      asOf: new Date(),
    });
    expect(result.manualQuoteAddOns).toEqual([]);
    expect(result.packageManualQuoteAddOns).toEqual([{ id: "inside_oven", label: "Oven Interior" }]);
  });
});
