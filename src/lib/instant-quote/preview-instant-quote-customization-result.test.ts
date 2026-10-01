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
      minimumServiceFloorApplied: false,
      movePackageLevel: null,
      moveCompleteUpgradeConfigured: null,
    });
    expect(safe).not.toHaveProperty("quoteId");
  });

  it("passes minimumServiceFloorApplied through from the engine's minimumServiceTotalApplied", () => {
    const estimate = calculateEstimateWithComparison(baseInput());
    const safe = mapToCustomizationPreviewResult(estimate);
    if (safe.estimateType === "instant_range") {
      expect(safe.minimumServiceFloorApplied).toBe(estimate.result.minimumServiceTotalApplied);
    } else {
      throw new Error("expected instant_range");
    }
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

  it("regression: the promotional comparison fields and the single upper-bound customer price are always present together", () => {
    const estimate = calculateEstimateWithComparison(baseInput({ firstCleaningEligible: true }));
    const safe = mapToCustomizationPreviewResult(estimate);
    if (safe.estimateType !== "instant_range") throw new Error("expected instant_range");
    expect(safe.firstCleaningOfferApplied).toBe(true);
    expect(safe.regularDisplayRangeLower).not.toBeNull();
    expect(safe.regularDisplayRangeUpper).not.toBeNull();
    expect(safe.displayRangeUpper).toBe(estimate.result.range!.upper);
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

  // -------------------------------------------------------------------
  // Move Basic/Complete display fields — what the live Move UI cards
  // (StepOneCleaning/CustomizeSection) actually consume.
  // -------------------------------------------------------------------

  it("echoes movePackageLevel and moveCompleteUpgradeConfigured for a priceable Complete request", () => {
    const estimate = calculateEstimateWithComparison(
      baseInput({ cleaningType: "move", movePackageLevel: "complete", squareFeet: 1300 })
    );
    const safe = mapToCustomizationPreviewResult(estimate);
    expect(safe.estimateType).toBe("instant_range");
    if (safe.estimateType === "instant_range") {
      expect(safe.movePackageLevel).toBe("complete");
      expect(safe.moveCompleteUpgradeConfigured).toBe(true);
      expect(safe.displayRangeLower).toBeGreaterThan(0);
    }
  });

  // Note: a "Complete beyond the sq-ft limit but Basic still priceable" case
  // can't be constructed through this preview path using real production
  // config — the general square-footage ceiling and the Complete-upgrade
  // ceiling both cap out at 4,500 sq ft for the largest tier, so that
  // combination is already fully manual for an unrelated reason first. That
  // exact branch (moveCompleteUpgradeConfigured: false while calculatedTotal
  // stays a valid Basic total) is verified directly against calculateEstimate
  // with an isolated config override in hotfix-2026-08-30.test.ts.

  it("movePackageLevel/moveCompleteUpgradeConfigured are both null for a non-Move request", () => {
    const estimate = calculateEstimateWithComparison(baseInput({ cleaningType: "standard" }));
    const safe = mapToCustomizationPreviewResult(estimate);
    expect(safe.estimateType).toBe("instant_range");
    if (safe.estimateType === "instant_range") {
      expect(safe.movePackageLevel).toBeNull();
      expect(safe.moveCompleteUpgradeConfigured).toBeNull();
    }
  });
});
