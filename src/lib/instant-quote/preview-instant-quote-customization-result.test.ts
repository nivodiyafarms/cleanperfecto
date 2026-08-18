import { describe, expect, it } from "vitest";
import { calculateEstimateWithComparison } from "./estimate-with-comparison";
import { mapToCustomizationPreviewResult } from "./preview-instant-quote-customization-result";
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

describe("mapToCustomizationPreviewResult", () => {
  it("maps an automatic instant-range estimate with no quoteId", () => {
    const estimate = calculateEstimateWithComparison(baseInput());
    const safe = mapToCustomizationPreviewResult(estimate);
    expect(safe).toEqual({
      success: true,
      estimateType: "instant_range",
      manualReviewRequired: false,
      displayRangeLower: 145,
      displayRangeUpper: 165,
      hasStartingAtPricing: false,
      prepaidPackageTotal: null,
      effectivePricePerVisit: null,
      firstCleaningOfferApplied: false,
      regularDisplayRangeLower: null,
      regularDisplayRangeUpper: null,
    });
    expect(safe).not.toHaveProperty("quoteId");
  });

  it("surfaces the regular comparison range when the offer is applied", () => {
    const estimate = calculateEstimateWithComparison(baseInput({ firstCleaningEligible: true }));
    const safe = mapToCustomizationPreviewResult(estimate);
    if (safe.estimateType === "instant_range") {
      expect(safe.firstCleaningOfferApplied).toBe(true);
      expect(safe.regularDisplayRangeLower).toBe(145);
      expect(safe.regularDisplayRangeUpper).toBe(165);
    } else {
      throw new Error("expected instant_range");
    }
  });

  it("maps a manual-review estimate to the generic customer-safe code", () => {
    const estimate = calculateEstimateWithComparison(baseInput({ zip: "00000" }));
    const safe = mapToCustomizationPreviewResult(estimate);
    expect(safe).toEqual({
      success: true,
      estimateType: "manual_review",
      manualReviewRequired: true,
      reasonCode: "custom_quote_required",
      customerMessage: "We received your request and will contact you to confirm the details and pricing.",
    });
  });

  it("reflects an added starting-at add-on in hasStartingAtPricing", () => {
    const estimate = calculateEstimateWithComparison(
      baseInput({ addOnIds: ["inside_cabinets_drawers"] })
    );
    const safe = mapToCustomizationPreviewResult(estimate);
    if (safe.estimateType === "instant_range") {
      expect(safe.hasStartingAtPricing).toBe(true);
    } else {
      throw new Error("expected instant_range");
    }
  });

  it("surfaces manualReviewRequired: true for a manual-quote add-on, without hiding the base range", () => {
    const estimate = calculateEstimateWithComparison(baseInput({ addOnIds: ["carpet_shampooing"] }));
    // The engine still returns instant-range (manualReviewRequired is a
    // separate flag) — the preview mapper only forces "manual_review" when
    // estimateType itself is manual-review or range is null.
    expect(estimate.result.estimateType).toBe("instant-range");

    const safe = mapToCustomizationPreviewResult(estimate);
    expect(safe.estimateType).toBe("instant_range");
    expect(safe.manualReviewRequired).toBe(true);
    if (safe.estimateType === "instant_range") {
      expect(safe.displayRangeLower).toBeGreaterThan(0);
    }
    expect(JSON.stringify(safe)).not.toContain("MANUAL_QUOTE_ADD_ON_SELECTED");
  });
});
