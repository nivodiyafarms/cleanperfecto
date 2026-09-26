import { describe, expect, it } from "vitest";
import { hasUnknownHistoricalTax } from "./prepaid-package-tax-guard";

describe("hasUnknownHistoricalTax", () => {
  it("is false for a known positive tax amount", () => {
    expect(hasUnknownHistoricalTax({ taxAmount: 63.58 })).toBe(false);
  });

  it("is false for an authoritative zero tax amount — 0 is a genuine fact, not a missing one", () => {
    expect(hasUnknownHistoricalTax({ taxAmount: 0 })).toBe(false);
  });

  it("is true for null — the historical Stripe tax fact was never recorded", () => {
    expect(hasUnknownHistoricalTax({ taxAmount: null })).toBe(true);
  });

  it("is true for undefined — a fixture/legacy row that never set the field at all, same as null", () => {
    expect(hasUnknownHistoricalTax({})).toBe(true);
  });
});
