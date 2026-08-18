import { describe, expect, it } from "vitest";
import { calculateEstimate } from "@/lib/pricing/calculate-estimate";
import type { CalculationInput } from "@/lib/pricing/types";
import { buildPricingSnapshot, mapEstimateTypeToDb } from "./pricing-snapshot";

const SAMPLE_INPUT: CalculationInput = {
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
  asOf: new Date("2026-08-20T00:00:00Z"),
};

describe("buildPricingSnapshot", () => {
  it("wraps input and result verbatim", () => {
    const result = calculateEstimate(SAMPLE_INPUT);
    const snapshot = buildPricingSnapshot(SAMPLE_INPUT, result);
    expect(snapshot.input).toBe(SAMPLE_INPUT);
    expect(snapshot.result).toBe(result);
  });
});

describe("mapEstimateTypeToDb", () => {
  it("maps instant-range to instant_range", () => {
    expect(mapEstimateTypeToDb("instant-range")).toBe("instant_range");
  });

  it("maps manual-review to manual_review", () => {
    expect(mapEstimateTypeToDb("manual-review")).toBe("manual_review");
  });
});
