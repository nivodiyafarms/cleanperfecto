import { describe, expect, it } from "vitest";
import { buildInstantQuoteEmailDetails } from "./build-email-details";
import type { SubmitInstantQuoteResult } from "../submit-instant-quote";
import type { InstantQuoteRawInput } from "../types";

type OkResult = Extract<SubmitInstantQuoteResult, { ok: true }>;

function rawInput(overrides: Partial<InstantQuoteRawInput> = {}): InstantQuoteRawInput {
  return {
    propertyType: "home",
    cleaningType: "standard",
    condition: "light",
    rooms: { bedrooms: 1, fullBathrooms: 1, halfBathrooms: 0 },
    frequency: "one_time",
    isPrepaidPackage: false,
    visitCount: 1,
    addOnIds: [],
    name: "  Jane Customer  ",
    phone: " 469-555-0100 ",
    email: " jane@example.com ",
    serviceAddress: { line1: "123 Main St", city: "Frisco", state: "TX", zip: "75056" },
    ...overrides,
  };
}

function okResult(overrides: Partial<OkResult> = {}): OkResult {
  return {
    ok: true,
    quoteId: "quote-1",
    customerId: "customer-1",
    identityConflict: false,
    estimateType: "instant_range",
    calculatedTotal: 105.3,
    range: { lower: 110, upper: 130 },
    hasStartingAtPricing: false,
    prepaidPackageTotal: null,
    effectivePricePerVisit: null,
    firstCleaningOfferApplied: true,
    regularRange: null,
    manualReviewRequired: false,
    manualReviewReasons: [],
    ...overrides,
  };
}

describe("buildInstantQuoteEmailDetails", () => {
  it("trims display strings", () => {
    const details = buildInstantQuoteEmailDetails(rawInput(), okResult());
    expect(details.name).toBe("Jane Customer");
    expect(details.phone).toBe("469-555-0100");
    expect(details.email).toBe("jane@example.com");
  });

  it("maps absent email/phone to null rather than an empty string", () => {
    const details = buildInstantQuoteEmailDetails(rawInput({ email: undefined }), okResult());
    expect(details.email).toBeNull();
  });

  it("carries every pricing/eligibility field straight from the trusted result", () => {
    const details = buildInstantQuoteEmailDetails(rawInput(), okResult());
    expect(details.calculatedTotal).toBe(105.3);
    expect(details.range).toEqual({ lower: 110, upper: 130 });
    expect(details.firstCleaningOfferApplied).toBe(true);
  });

  it("carries manualReviewReasons and identityConflict through for the admin email", () => {
    const details = buildInstantQuoteEmailDetails(
      rawInput(),
      okResult({
        estimateType: "manual_review",
        range: null,
        identityConflict: true,
        manualReviewRequired: true,
        manualReviewReasons: ["CUSTOMER_IDENTITY_CONFLICT"],
      })
    );
    expect(details.identityConflict).toBe(true);
    expect(details.manualReviewReasons).toEqual(["CUSTOMER_IDENTITY_CONFLICT"]);
  });

  it("defaults squareFeet, preferredDate, message, leadSource to null when omitted", () => {
    const details = buildInstantQuoteEmailDetails(rawInput(), okResult());
    expect(details.squareFeet).toBeNull();
    expect(details.preferredDate).toBeNull();
    expect(details.message).toBeNull();
    expect(details.leadSource).toBeNull();
  });

  it("passes visitAddOns through for a package quote", () => {
    const details = buildInstantQuoteEmailDetails(
      rawInput({ isPrepaidPackage: true, visitCount: 6, visitAddOns: [["inside_oven"], []] }),
      okResult({ prepaidPackageTotal: 735.01, effectivePricePerVisit: 122.5 })
    );
    expect(details.visitAddOns).toEqual([["inside_oven"], []]);
    expect(details.prepaidPackageTotal).toBe(735.01);
  });
});
