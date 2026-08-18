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
    manualReviewRequired: false,
    manualReviewReasons: [],
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
    });
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
