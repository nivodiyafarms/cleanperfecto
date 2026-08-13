import { describe, expect, it } from "vitest";
import { getSquareFootageMultiplier, type SquareFootageBand } from "./square-footage";

// TEST-ONLY fixture — must never be copied into production config.
const TEST_SQFT_CONFIG: SquareFootageBand[] = [
  {
    sizeTier: "2br_2ba",
    includedSqFt: 1000,
    additionalBandSqFt: 200,
    multiplierPerBand: 0.05,
    maxConfiguredSqFt: 1800,
  },
];

describe("getSquareFootageMultiplier", () => {
  it("returns multiplier 1.00 at or below the included allowance", () => {
    expect(getSquareFootageMultiplier("2br_2ba", 900, TEST_SQFT_CONFIG)).toEqual({
      configured: true,
      multiplier: 1,
    });
    expect(getSquareFootageMultiplier("2br_2ba", 1000, TEST_SQFT_CONFIG)).toEqual({
      configured: true,
      multiplier: 1,
    });
  });

  it("adds one multiplier band per additional band of square footage", () => {
    // 1200 sqft = 200 over the 1000 included allowance = exactly 1 band
    expect(getSquareFootageMultiplier("2br_2ba", 1200, TEST_SQFT_CONFIG)).toEqual({
      configured: true,
      multiplier: 1.05,
    });
    // 1250 sqft rounds up to 2 bands (partial band still counts as a full band)
    expect(getSquareFootageMultiplier("2br_2ba", 1250, TEST_SQFT_CONFIG)).toEqual({
      configured: true,
      multiplier: 1.1,
    });
  });

  it("returns a typed manual-review reason beyond the configured limit", () => {
    expect(getSquareFootageMultiplier("2br_2ba", 2000, TEST_SQFT_CONFIG)).toEqual({
      configured: false,
      reason: "SQUARE_FOOTAGE_BEYOND_CONFIGURED_LIMIT",
    });
  });

  it("returns a typed manual-review reason for an unconfigured size tier", () => {
    expect(getSquareFootageMultiplier("studio_1ba", 500, TEST_SQFT_CONFIG)).toEqual({
      configured: false,
      reason: "SQUARE_FOOTAGE_NOT_CONFIGURED",
    });
  });

  it("production SQUARE_FOOTAGE_CONFIG is empty until approved thresholds are supplied", async () => {
    const { SQUARE_FOOTAGE_CONFIG } = await import("./square-footage");
    expect(SQUARE_FOOTAGE_CONFIG).toEqual([]);
  });
});
