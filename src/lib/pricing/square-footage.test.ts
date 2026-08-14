import { describe, expect, it } from "vitest";
import {
  getSquareFootageMultiplier,
  resolveDefaultSquareFeet,
  SQUARE_FOOTAGE_CONFIG,
  type SquareFootageBand,
} from "./square-footage";

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
});

// ---------------------------------------------------------------------------
// Production config — owner-approved 2026-08-13
// ---------------------------------------------------------------------------

describe("production SQUARE_FOOTAGE_CONFIG", () => {
  it("matches the approved included-square-footage allowance per size tier", () => {
    const allowances = Object.fromEntries(SQUARE_FOOTAGE_CONFIG.map((band) => [band.sizeTier, band.includedSqFt]));
    expect(allowances).toEqual({
      studio_1ba: 750,
      "1br_1ba": 1000,
      "2br_2ba": 1600,
      "3br_2ba": 2200,
      "4br_plus": 3000,
    });
  });

  it("uses 500 sq ft bands at +5% per band, capped at 3 bands (+15%)", () => {
    for (const band of SQUARE_FOOTAGE_CONFIG) {
      expect(band.additionalBandSqFt).toBe(500);
      expect(band.multiplierPerBand).toBe(0.05);
      expect(band.maxConfiguredSqFt).toBe(band.includedSqFt + 1500);
    }
  });

  describe.each([
    {
      label: "1B1B",
      sizeTier: "1br_1ba" as const,
      cases: [
        { sqft: 1000, expected: 1.0 },
        { sqft: 1001, expected: 1.05 },
        { sqft: 1500, expected: 1.05 },
        { sqft: 1501, expected: 1.1 },
        { sqft: 2000, expected: 1.1 },
        { sqft: 2001, expected: 1.15 },
        { sqft: 2500, expected: 1.15 },
      ],
      manualReviewAt: 2501,
    },
    {
      label: "3B2B",
      sizeTier: "3br_2ba" as const,
      cases: [
        { sqft: 2200, expected: 1.0 },
        { sqft: 2201, expected: 1.05 },
        { sqft: 2700, expected: 1.05 },
        { sqft: 2701, expected: 1.1 },
        { sqft: 3200, expected: 1.1 },
        { sqft: 3201, expected: 1.15 },
        { sqft: 3700, expected: 1.15 },
      ],
      manualReviewAt: 3701,
    },
    {
      label: "4B3B",
      sizeTier: "4br_plus" as const,
      cases: [
        { sqft: 3000, expected: 1.0 },
        { sqft: 3001, expected: 1.05 },
        { sqft: 3500, expected: 1.05 },
        { sqft: 3501, expected: 1.1 },
        { sqft: 4000, expected: 1.1 },
        { sqft: 4001, expected: 1.15 },
        { sqft: 4500, expected: 1.15 },
      ],
      manualReviewAt: 4501,
    },
  ])("$label boundaries", ({ sizeTier, cases, manualReviewAt }) => {
    it.each(cases)("$sqft sq ft resolves to multiplier $expected", ({ sqft, expected }) => {
      expect(getSquareFootageMultiplier(sizeTier, sqft, SQUARE_FOOTAGE_CONFIG)).toEqual({
        configured: true,
        multiplier: expected,
      });
    });

    it(`beyond the configured limit (${manualReviewAt} sq ft) requires manual review, never an invented multiplier`, () => {
      expect(getSquareFootageMultiplier(sizeTier, manualReviewAt, SQUARE_FOOTAGE_CONFIG)).toEqual({
        configured: false,
        reason: "SQUARE_FOOTAGE_BEYOND_CONFIGURED_LIMIT",
      });
    });
  });
});

describe("resolveDefaultSquareFeet", () => {
  it("returns the size tier's included allowance as the default context", () => {
    expect(resolveDefaultSquareFeet("3br_2ba", SQUARE_FOOTAGE_CONFIG)).toBe(2200);
  });

  it("returns null when the config has no entry for the size tier", () => {
    expect(resolveDefaultSquareFeet("2br_2ba", TEST_SQFT_CONFIG.filter((b) => b.sizeTier !== "2br_2ba"))).toBeNull();
  });
});
