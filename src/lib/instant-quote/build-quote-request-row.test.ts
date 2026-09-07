import { describe, expect, it } from "vitest";
import { calculateEstimate } from "@/lib/pricing/calculate-estimate";
import type { CalculationInput } from "@/lib/pricing/types";
import { buildQuoteRequestRow } from "./build-quote-request-row";
import { buildCalculationInput } from "./build-calculation-input";
import { resolveLegacyServiceId } from "./legacy-service-id";
import type { ValidatedInstantQuoteInput } from "./types";

function validated(overrides: Partial<ValidatedInstantQuoteInput> = {}): ValidatedInstantQuoteInput {
  return {
    propertyType: "home",
    cleaningType: "standard",
    condition: "light",
    rooms: { bedrooms: 1, fullBathrooms: 1, halfBathrooms: 0 },
    squareFeet: null,
    frequency: "one_time",
    isPrepaidPackage: false,
    visitCount: 1,
    addOnIds: [],
    visitAddOns: null,
    specialRooms: [],
    movePackageLevel: null,
    moveDirection: null,
    outdoorSelection: null,
    quantifiedAddOns: [],
    name: "Jane Customer",
    phone: "469-555-0100",
    email: "jane@example.com",
    serviceAddress: { line1: "123 Main St", line2: "Apt 4B", city: "Frisco", state: "TX", zip: "75056" },
    preferredDate: "2026-09-01",
    message: "Please call ahead",
    leadSource: "google",
    leadSourceDetail: "search ad",
    ...overrides,
  };
}

function runFor(overrides: Partial<ValidatedInstantQuoteInput> = {}, firstCleaningEligible = false) {
  const asOf = new Date("2026-08-20T00:00:00Z");
  const v = validated(overrides);
  const calculationInput: CalculationInput = buildCalculationInput(v, firstCleaningEligible, asOf);
  const result = calculateEstimate(calculationInput);
  return { v, calculationInput, result };
}

describe("buildQuoteRequestRow", () => {
  it("maps every scalar field for a standard one-time instant-range quote", () => {
    const { v, calculationInput, result } = runFor();
    const row = buildQuoteRequestRow({
      id: "quote-1",
      customerId: "customer-1",
      entryChannel: "website",
      validated: v,
      emailNormalized: "jane@example.com",
      phoneNormalized: "+14695550100",
      serviceAddressIdentity: "75056|123 MAIN ST|APT 4B",
      legacyServiceId: resolveLegacyServiceId(v.cleaningType, v.frequency),
      calculationInput,
      calculationResult: result,
    });

    expect(row).toMatchObject({
      id: "quote-1",
      name: "Jane Customer",
      phone: "469-555-0100",
      email: "jane@example.com",
      zip: "75056",
      property_type: "home",
      service_id: "standard",
      preferred_date: "2026-09-01",
      message: "Please call ahead",
      customer_id: "customer-1",
      entry_channel: "website",
      lead_source: "google",
      lead_source_detail: "search ad",
      cleaning_type: "standard",
      frequency: "one_time",
      is_prepaid_package: false,
      visit_count: 1,
      bedrooms: 1,
      full_bathrooms: 1,
      half_bathrooms: 0,
      square_feet: null,
      condition: "light",
      service_address_line1: "123 Main St",
      service_address_line2: "Apt 4B",
      service_city: "Frisco",
      service_state: "TX",
      service_address_identity: "75056|123 MAIN ST|APT 4B",
      email_normalized: "jane@example.com",
      phone_normalized: "+14695550100",
      estimate_type: "instant_range",
      pricing_version: result.pricingVersion,
      calculated_total: result.calculatedTotal,
      display_range_lower: result.range!.lower,
      display_range_upper: result.range!.upper,
      prepaid_package_total: null,
      effective_price_per_visit: null,
      has_starting_at_pricing: false,
      first_cleaning_offer_applied: false,
    });
    expect(row.manual_review_reasons).toEqual([]);
  });

  it("keeps scalar fields consistent with pricing_snapshot.result", () => {
    const { v, calculationInput, result } = runFor();
    const row = buildQuoteRequestRow({
      id: "quote-1",
      customerId: "customer-1",
      entryChannel: "website",
      validated: v,
      emailNormalized: "jane@example.com",
      phoneNormalized: "+14695550100",
      serviceAddressIdentity: null,
      legacyServiceId: resolveLegacyServiceId(v.cleaningType, v.frequency),
      calculationInput,
      calculationResult: result,
    });

    expect(row.calculated_total).toBe(row.pricing_snapshot.result.calculatedTotal);
    expect(row.pricing_snapshot.input).toBe(calculationInput);
    expect(row.pricing_snapshot.result).toBe(result);
  });

  it("maps a manual-review estimate type to manual_review and preserves the engine's reasons", () => {
    const { v, calculationInput, result } = runFor({ serviceAddress: { line1: "1 Main St", line2: null, city: null, state: null, zip: "00000" } });
    expect(result.estimateType).toBe("manual-review");
    const row = buildQuoteRequestRow({
      id: "quote-1",
      customerId: "customer-1",
      entryChannel: "website",
      validated: v,
      emailNormalized: null,
      phoneNormalized: null,
      serviceAddressIdentity: null,
      legacyServiceId: resolveLegacyServiceId(v.cleaningType, v.frequency),
      calculationInput,
      calculationResult: result,
    });
    expect(row.estimate_type).toBe("manual_review");
    expect(row.manual_review_reasons).toContain("ZIP_TRAVEL_NOT_CONFIGURED");
  });

  it("appends the identity-conflict reason alongside any engine-produced reasons", () => {
    const { v, calculationInput, result } = runFor();
    const row = buildQuoteRequestRow({
      id: "quote-1",
      customerId: null,
      entryChannel: "website",
      validated: v,
      emailNormalized: "jane@example.com",
      phoneNormalized: "+14695550100",
      serviceAddressIdentity: null,
      legacyServiceId: resolveLegacyServiceId(v.cleaningType, v.frequency),
      calculationInput,
      calculationResult: result,
      additionalManualReviewReasons: ["CUSTOMER_IDENTITY_CONFLICT"],
    });
    expect(row.manual_review_reasons).toEqual(["CUSTOMER_IDENTITY_CONFLICT"]);
    expect(row.customer_id).toBeNull();
  });

  it("maps recurring frequency to the legacy 'recurring' service_id while keeping cleaning_type/frequency orthogonal", () => {
    const { v, calculationInput, result } = runFor({ frequency: "weekly", cleaningType: "deep" });
    const row = buildQuoteRequestRow({
      id: "quote-1",
      customerId: "customer-1",
      entryChannel: "website",
      validated: v,
      emailNormalized: null,
      phoneNormalized: null,
      serviceAddressIdentity: null,
      legacyServiceId: resolveLegacyServiceId(v.cleaningType, v.frequency),
      calculationInput,
      calculationResult: result,
    });
    expect(row.service_id).toBe("recurring");
    expect(row.cleaning_type).toBe("deep");
    expect(row.frequency).toBe("weekly");
  });

  it("preserves the real DB property_type value without collapsing apartment to home", () => {
    const { v, calculationInput, result } = runFor({ propertyType: "apartment" });
    const row = buildQuoteRequestRow({
      id: "quote-1",
      customerId: "customer-1",
      entryChannel: "website",
      validated: v,
      emailNormalized: null,
      phoneNormalized: null,
      serviceAddressIdentity: null,
      legacyServiceId: resolveLegacyServiceId(v.cleaningType, v.frequency),
      calculationInput,
      calculationResult: result,
    });
    expect(row.property_type).toBe("apartment");
  });

  it("does not include a created_at or status field — DB defaults own those", () => {
    const { v, calculationInput, result } = runFor();
    const row = buildQuoteRequestRow({
      id: "quote-1",
      customerId: "customer-1",
      entryChannel: "website",
      validated: v,
      emailNormalized: null,
      phoneNormalized: null,
      serviceAddressIdentity: null,
      legacyServiceId: resolveLegacyServiceId(v.cleaningType, v.frequency),
      calculationInput,
      calculationResult: result,
    });
    expect(row).not.toHaveProperty("created_at");
    expect(row).not.toHaveProperty("status");
  });

  it("forceManualReview overrides estimate_type to manual_review even when the engine returned instant-range", () => {
    const { v, calculationInput, result } = runFor();
    expect(result.estimateType).toBe("instant-range"); // sanity check on the fixture
    const row = buildQuoteRequestRow({
      id: "quote-1",
      customerId: null,
      entryChannel: "website",
      validated: v,
      emailNormalized: null,
      phoneNormalized: null,
      serviceAddressIdentity: null,
      legacyServiceId: resolveLegacyServiceId(v.cleaningType, v.frequency),
      calculationInput,
      calculationResult: result,
      additionalManualReviewReasons: ["CUSTOMER_IDENTITY_CONFLICT"],
      forceManualReview: true,
    });
    expect(row.estimate_type).toBe("manual_review");
    // The real calculated figures are still persisted as informational context, not zeroed out.
    expect(row.calculated_total).toBe(result.calculatedTotal);
    expect(row.display_range_lower).toBe(result.range!.lower);
  });

  it("marks first_cleaning_offer_applied true only when the engine actually applied that discount program", () => {
    const { v, calculationInput, result } = runFor({}, true);
    expect(result.discountProgram).toBe("first_cleaning");
    const row = buildQuoteRequestRow({
      id: "quote-1",
      customerId: "customer-1",
      entryChannel: "website",
      validated: v,
      emailNormalized: null,
      phoneNormalized: null,
      serviceAddressIdentity: null,
      legacyServiceId: resolveLegacyServiceId(v.cleaningType, v.frequency),
      calculationInput,
      calculationResult: result,
    });
    expect(row.first_cleaning_offer_applied).toBe(true);
  });
});
