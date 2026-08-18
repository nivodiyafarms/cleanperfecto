import { describe, expect, it } from "vitest";
import { buildCalculationInput, mapPropertyTypeToPricingKind } from "./build-calculation-input";
import type { ValidatedInstantQuoteInput } from "./types";

function validated(overrides: Partial<ValidatedInstantQuoteInput> = {}): ValidatedInstantQuoteInput {
  return {
    propertyType: "home",
    cleaningType: "standard",
    condition: "light",
    rooms: { bedrooms: 2, fullBathrooms: 2, halfBathrooms: 0 },
    squareFeet: null,
    frequency: "one_time",
    isPrepaidPackage: false,
    visitCount: 1,
    addOnIds: [],
    visitAddOns: null,
    name: "Jane Customer",
    phone: "469-555-0100",
    email: "jane@example.com",
    serviceAddress: { line1: "123 Main St", line2: null, city: "Frisco", state: "TX", zip: "75056" },
    preferredDate: null,
    message: null,
    leadSource: null,
    leadSourceDetail: null,
    ...overrides,
  };
}

describe("mapPropertyTypeToPricingKind", () => {
  it("passes home/apartment/airbnb through unchanged", () => {
    expect(mapPropertyTypeToPricingKind("home")).toBe("home");
    expect(mapPropertyTypeToPricingKind("apartment")).toBe("apartment");
    expect(mapPropertyTypeToPricingKind("airbnb")).toBe("airbnb");
  });

  it("collapses restaurant/office to commercial", () => {
    expect(mapPropertyTypeToPricingKind("restaurant")).toBe("commercial");
    expect(mapPropertyTypeToPricingKind("office")).toBe("commercial");
  });
});

describe("buildCalculationInput", () => {
  it("resolves sizeTier from bedrooms and passes rooms through for adjustment purposes", () => {
    const asOf = new Date("2026-08-20T00:00:00Z");
    const input = buildCalculationInput(validated(), false, asOf);
    expect(input.sizeTier).toBe("2br_2ba");
    expect(input.rooms).toEqual({ bedrooms: 2, fullBathrooms: 2, halfBathrooms: 0 });
    expect(input.zip).toBe("75056");
    expect(input.asOf).toBe(asOf);
  });

  it("passes the server-determined firstCleaningEligible through untouched", () => {
    const input = buildCalculationInput(validated(), true, new Date());
    expect(input.firstCleaningEligible).toBe(true);
  });

  it("converts null squareFeet to undefined so the engine treats it as not provided", () => {
    const input = buildCalculationInput(validated({ squareFeet: null }), false, new Date());
    expect(input.squareFeet).toBeUndefined();
  });

  it("passes a provided squareFeet through as a number", () => {
    const input = buildCalculationInput(validated({ squareFeet: 1500 }), false, new Date());
    expect(input.squareFeet).toBe(1500);
  });

  it("converts null visitAddOns to undefined", () => {
    const input = buildCalculationInput(validated({ visitAddOns: null }), false, new Date());
    expect(input.visitAddOns).toBeUndefined();
  });

  it("passes provided visitAddOns through", () => {
    const input = buildCalculationInput(
      validated({ visitAddOns: [["inside_oven"], []] }),
      false,
      new Date()
    );
    expect(input.visitAddOns).toEqual([["inside_oven"], []]);
  });

  it("maps a commercial property type to the commercial PropertyKind", () => {
    const input = buildCalculationInput(validated({ propertyType: "restaurant" }), false, new Date());
    expect(input.propertyKind).toBe("commercial");
  });
});
