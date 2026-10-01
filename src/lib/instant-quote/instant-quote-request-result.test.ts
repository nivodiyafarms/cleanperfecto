import { describe, expect, it } from "vitest";
import { mapToCustomerSafeResult } from "./instant-quote-request-result";
import type { SubmitInstantQuoteResult } from "./submit-instant-quote";

type OkResult = Extract<SubmitInstantQuoteResult, { ok: true }>;

function okResult(overrides: Partial<OkResult> = {}): OkResult {
  return {
    ok: true,
    quoteId: "quote-1",
    customerId: "customer-1",
    identityConflict: false,
    estimateType: "instant_range",
    calculatedTotal: 144,
    range: { lower: 145, upper: 165 },
    hasStartingAtPricing: false,
    prepaidPackageTotal: null,
    effectivePricePerVisit: null,
    firstCleaningOfferApplied: false,
    regularRange: null,
    manualReviewRequired: false,
    manualReviewReasons: [],
    minimumServiceTotalApplied: false,
    movePackageLevel: null,
    moveCompleteUpgradeConfigured: null,
    ...overrides,
  };
}

describe("mapToCustomerSafeResult", () => {
  it("maps an automatic instant-range result", () => {
    const safe = mapToCustomerSafeResult(okResult());
    expect(safe).toEqual({
      success: true,
      quoteId: "quote-1",
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
  });

  it("surfaces minimumServiceFloorApplied only when the $99 floor actually capped the discount", () => {
    const uncapped = mapToCustomerSafeResult(okResult({ minimumServiceTotalApplied: false }));
    const capped = mapToCustomerSafeResult(okResult({ minimumServiceTotalApplied: true }));
    if (uncapped.estimateType === "instant_range" && capped.estimateType === "instant_range") {
      expect(uncapped.minimumServiceFloorApplied).toBe(false);
      expect(capped.minimumServiceFloorApplied).toBe(true);
    } else {
      throw new Error("expected instant_range");
    }
  });

  it("carries prepaidPackageTotal/effectivePricePerVisit through for a package", () => {
    const safe = mapToCustomerSafeResult(
      okResult({ prepaidPackageTotal: 700.01, effectivePricePerVisit: 116.67 })
    );
    if (safe.estimateType === "instant_range") {
      expect(safe.prepaidPackageTotal).toBe(700.01);
      expect(safe.effectivePricePerVisit).toBe(116.67);
    } else {
      throw new Error("expected instant_range");
    }
  });

  it("surfaces hasStartingAtPricing and firstCleaningOfferApplied", () => {
    const safe = mapToCustomerSafeResult(
      okResult({ hasStartingAtPricing: true, firstCleaningOfferApplied: true })
    );
    if (safe.estimateType === "instant_range") {
      expect(safe.hasStartingAtPricing).toBe(true);
      expect(safe.firstCleaningOfferApplied).toBe(true);
    } else {
      throw new Error("expected instant_range");
    }
  });

  it("surfaces the regular comparison range when the first-cleaning offer was applied", () => {
    const safe = mapToCustomerSafeResult(
      okResult({
        firstCleaningOfferApplied: true,
        range: { lower: 110, upper: 130 },
        regularRange: { lower: 145, upper: 165 },
      })
    );
    if (safe.estimateType === "instant_range") {
      expect(safe.regularDisplayRangeLower).toBe(145);
      expect(safe.regularDisplayRangeUpper).toBe(165);
    } else {
      throw new Error("expected instant_range");
    }
  });

  it("regression: the promotional comparison fields and the single upper-bound customer price are ALWAYS present together — the range-to-single-price change must never suppress the discount badge/crossed-out price, and vice versa", () => {
    const safe = mapToCustomerSafeResult(
      okResult({
        firstCleaningOfferApplied: true,
        range: { lower: 180, upper: 205 },
        regularRange: { lower: 240, upper: 275 },
      })
    );
    if (safe.estimateType !== "instant_range") throw new Error("expected instant_range");
    // The promo-gating fields the UI's showComparison check reads:
    expect(safe.firstCleaningOfferApplied).toBe(true);
    expect(safe.regularDisplayRangeLower).toBe(240);
    expect(safe.regularDisplayRangeUpper).toBe(275);
    // The single customer-facing price the UI now renders instead of a range:
    expect(safe.displayRangeUpper).toBe(205);
    expect(safe.displayRangeLower).toBe(180);
  });

  it("never fabricates a regular comparison range when the offer was not applied, even if regularRange were somehow non-null", () => {
    const safe = mapToCustomerSafeResult(
      okResult({ firstCleaningOfferApplied: false, regularRange: { lower: 999, upper: 1000 } })
    );
    if (safe.estimateType === "instant_range") {
      expect(safe.regularDisplayRangeLower).toBeNull();
      expect(safe.regularDisplayRangeUpper).toBeNull();
    } else {
      throw new Error("expected instant_range");
    }
  });

  it("returns null regular range fields when the offer was applied but regularRange is null (defensive)", () => {
    const safe = mapToCustomerSafeResult(
      okResult({ firstCleaningOfferApplied: true, regularRange: null })
    );
    if (safe.estimateType === "instant_range") {
      expect(safe.regularDisplayRangeLower).toBeNull();
      expect(safe.regularDisplayRangeUpper).toBeNull();
    } else {
      throw new Error("expected instant_range");
    }
  });

  it("surfaces manualReviewRequired: true for an instant_range result carrying a manual-quote add-on, without hiding the base range", () => {
    const safe = mapToCustomerSafeResult(
      okResult({ manualReviewRequired: true, manualReviewReasons: ["MANUAL_QUOTE_ADD_ON_SELECTED"] })
    );
    expect(safe.estimateType).toBe("instant_range");
    expect(safe.manualReviewRequired).toBe(true);
    if (safe.estimateType === "instant_range") {
      expect(safe.displayRangeLower).toBe(145);
      expect(safe.displayRangeUpper).toBe(165);
    }
    expect(JSON.stringify(safe)).not.toContain("MANUAL_QUOTE_ADD_ON_SELECTED");
  });

  it("maps a manual-review result to a generic customer-safe code, never the internal reasons", () => {
    const safe = mapToCustomerSafeResult(
      okResult({
        estimateType: "manual_review",
        range: null,
        manualReviewRequired: true,
        manualReviewReasons: ["ZIP_TRAVEL_NOT_CONFIGURED", "CUSTOMER_IDENTITY_CONFLICT"],
      })
    );
    expect(safe).toEqual({
      success: true,
      quoteId: "quote-1",
      estimateType: "manual_review",
      manualReviewRequired: true,
      reasonCode: "custom_quote_required",
      customerMessage: "We received your request and will contact you to confirm the details and pricing.",
    });
    expect(JSON.stringify(safe)).not.toContain("ZIP_TRAVEL_NOT_CONFIGURED");
    expect(JSON.stringify(safe)).not.toContain("CUSTOMER_IDENTITY_CONFLICT");
  });

  it("maps an identity-conflict result the same safe way as any other manual review, without leaking conflict details", () => {
    const safe = mapToCustomerSafeResult(
      okResult({
        estimateType: "manual_review",
        range: null,
        customerId: null,
        identityConflict: true,
        manualReviewRequired: true,
        manualReviewReasons: ["CUSTOMER_IDENTITY_CONFLICT"],
      })
    );
    expect(safe.estimateType).toBe("manual_review");
    expect(JSON.stringify(safe)).not.toContain("customerId");
    expect(JSON.stringify(safe)).not.toContain("identityConflict");
  });

  it("never includes a customer/database identifier beyond quoteId", () => {
    const safe = mapToCustomerSafeResult(okResult());
    const keys = Object.keys(safe);
    expect(keys).not.toContain("customerId");
    expect(keys).not.toContain("manualReviewReasons");
    expect(keys).not.toContain("calculatedTotal");
  });
});
