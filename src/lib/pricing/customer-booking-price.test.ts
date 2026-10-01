import { describe, expect, it } from "vitest";
import { calculateEstimate } from "./calculate-estimate";
import { resolveCustomerBookingPrice } from "./customer-booking-price";
import { STANDARD_OFFER_PERCENT } from "@/lib/offers/first-cleaning-offer";
import type { CalculationInput, CalculationResult } from "./types";
import type { SuppliesEquipmentRule } from "./supplies-equipment";
import type { ZipTravelRule } from "./zip-travel";

function fakeResult(overrides: Partial<CalculationResult>): CalculationResult {
  return {
    range: null,
    calculatedTotal: 0,
    ...overrides,
  } as CalculationResult;
}

describe("resolveCustomerBookingPrice", () => {
  it("post-discount range $129–$149 yields customer price $149 — the upper bound, never the lower bound or a midpoint", () => {
    const result = fakeResult({ range: { lower: 129, upper: 149 }, calculatedTotal: 124 });
    expect(resolveCustomerBookingPrice(result)).toBe(149);
  });

  it("falls back to calculatedTotal only when no range exists (manual-review) — never reachable for a genuine bookable estimate", () => {
    const result = fakeResult({ range: null, calculatedTotal: 0 });
    expect(resolveCustomerBookingPrice(result)).toBe(0);
  });

  it("never recalculates anything — reads range.upper verbatim, whatever value it holds", () => {
    const result = fakeResult({ range: { lower: 200, upper: 275 }, calculatedTotal: 190 });
    expect(resolveCustomerBookingPrice(result)).toBe(275);
  });
});

const TEST_ZIP_NO_TRAVEL: ZipTravelRule[] = [{ zip: "99999", percentage: 0, band: "core" }];
const TEST_SUPPLIES_CONFIG: SuppliesEquipmentRule[] = (["standard", "deep", "move"] as const).map((cleaningType) => ({
  cleaningType,
  minSqFt: 0,
  maxSqFt: 100000,
  amount: 15,
}));
const TEST_OVERRIDES = { zipTravelConfig: TEST_ZIP_NO_TRAVEL, suppliesEquipmentConfig: TEST_SUPPLIES_CONFIG };

function baseInput(overrides: Partial<CalculationInput> = {}): CalculationInput {
  return {
    propertyKind: "home",
    cleaningType: "standard",
    condition: "light",
    sizeTier: "1br_1ba",
    zip: "99999",
    frequency: "one_time",
    isPrepaidPackage: false,
    visitCount: 1,
    addOnIds: [],
    firstCleaningEligible: false,
    asOf: new Date("2026-06-01T12:00:00-05:00"),
    ...overrides,
  };
}

describe("resolveCustomerBookingPrice — wired through the real pricing/promotion engine", () => {
  it("with the active existing first-cleaning promotion applied, resolves to exactly the engine's own post-discount range.upper — no new/duplicated discount math", () => {
    // asOf is inside the STANDARD (post-2026-09-01) offer window per
    // src/lib/offers/first-cleaning-offer.ts — this test never hardcodes
    // the 25% figure itself; it only asserts the resolved price matches
    // whatever the REAL, unmodified engine already computed.
    const result = calculateEstimate(
      baseInput({ firstCleaningEligible: true, asOf: new Date("2026-09-15T12:00:00-05:00") }),
      TEST_OVERRIDES
    );

    expect(result.discountProgram).toBe("first_cleaning");
    expect(result.activeFirstCleaningOfferPercent).toBe(STANDARD_OFFER_PERCENT);
    expect(result.range).not.toBeNull();
    expect(resolveCustomerBookingPrice(result)).toBe(result.range!.upper);
    // The upper bound is strictly the range's own value — never calculatedTotal
    // (the pre-range figure the range's lower bound is rounded up from) and
    // never the lower bound.
    expect(resolveCustomerBookingPrice(result)).not.toBe(result.calculatedTotal);
    expect(resolveCustomerBookingPrice(result)).not.toBe(result.range!.lower);
  });

  it("with no active promotion (not first-cleaning eligible), still resolves to the engine's own range.upper — the mechanism is identical with or without a promotion", () => {
    const result = calculateEstimate(baseInput({ firstCleaningEligible: false }), TEST_OVERRIDES);

    expect(result.discountProgram).toBe("none");
    expect(resolveCustomerBookingPrice(result)).toBe(result.range!.upper);
  });

  it("add-ons remain unchanged — resolves to the range computed from the addon-inclusive calculatedTotal, without any addon-specific handling in resolveCustomerBookingPrice itself", () => {
    const withoutAddOns = calculateEstimate(baseInput(), TEST_OVERRIDES);
    const withAddOns = calculateEstimate(baseInput({ addOnIds: ["inside_oven"] }), TEST_OVERRIDES);

    expect(resolveCustomerBookingPrice(withAddOns)).toBe(withAddOns.range!.upper);
    expect(resolveCustomerBookingPrice(withAddOns)).toBeGreaterThan(resolveCustomerBookingPrice(withoutAddOns));
  });

  it("recurring discounts remain unchanged — a weekly recurring estimate still resolves to that estimate's own range.upper", () => {
    const result = calculateEstimate(baseInput({ frequency: "weekly", firstCleaningEligible: false }), TEST_OVERRIDES);

    expect(result.discountProgram).toBe("recurring_cycle");
    expect(resolveCustomerBookingPrice(result)).toBe(result.range!.upper);
  });

  it("the internal lower bound remains available on the same result for operations, even though the customer-facing price is the upper bound", () => {
    const result = calculateEstimate(baseInput({ firstCleaningEligible: true, asOf: new Date("2026-09-15T12:00:00-05:00") }), TEST_OVERRIDES);

    expect(result.range!.lower).toBeLessThan(result.range!.upper);
    expect(resolveCustomerBookingPrice(result)).toBe(result.range!.upper);
  });

  it("commercial requests never reach a range at all — resolves to calculatedTotal (0), matching the existing manual-review-only commercial behavior, unmodified", () => {
    const result = calculateEstimate(baseInput({ propertyKind: "commercial" }), TEST_OVERRIDES);

    expect(result.estimateType).toBe("manual-review");
    expect(result.range).toBeNull();
    expect(resolveCustomerBookingPrice(result)).toBe(result.calculatedTotal);
  });
});
