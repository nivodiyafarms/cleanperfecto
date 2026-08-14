import { describe, expect, it } from "vitest";
import {
  BASE_ZIP,
  getZipTravelRule,
  TRAVEL_BAND_PERCENTAGES,
  ZIP_TRAVEL_CONFIG,
  type AutomaticTravelBand,
  type TravelBand,
  type ZipTravelRule,
} from "./zip-travel";

// TEST-ONLY fixtures — must never be copied into production config.
const TEST_ZIP_CONFIG: ZipTravelRule[] = [
  { zip: "99991", percentage: 0.05, band: "nearby" },
  { zip: "99992", percentage: 0.12, band: "outer" },
  { zip: "99993", percentage: null, band: "manual_review" },
];

describe("getZipTravelRule", () => {
  it("returns the identical percentage for the same ZIP every time", () => {
    const first = getZipTravelRule("99991", TEST_ZIP_CONFIG);
    const second = getZipTravelRule("99991", TEST_ZIP_CONFIG);
    const third = getZipTravelRule("99991", TEST_ZIP_CONFIG);

    expect(first).toEqual({ configured: true, percentage: 0.05, band: "nearby" });
    expect(second).toEqual(first);
    expect(third).toEqual(first);
  });

  it("resolves different configured ZIPs to their own fixed percentage", () => {
    expect(getZipTravelRule("99992", TEST_ZIP_CONFIG)).toEqual({
      configured: true,
      percentage: 0.12,
      band: "outer",
    });
  });

  it("returns the ZIP_TRAVEL_NOT_CONFIGURED result for a ZIP absent from the table entirely", () => {
    expect(getZipTravelRule("00000", TEST_ZIP_CONFIG)).toEqual({
      configured: false,
      reason: "ZIP_TRAVEL_NOT_CONFIGURED",
    });
  });

  it("returns the distinct ZIP_MANUAL_REVIEW_REQUIRED result for a ZIP explicitly known to require manual review", () => {
    expect(getZipTravelRule("99993", TEST_ZIP_CONFIG)).toEqual({
      configured: false,
      reason: "ZIP_MANUAL_REVIEW_REQUIRED",
      band: "manual_review",
    });
  });

  it("keeps 'known ZIP, manual review' and 'unknown ZIP' semantically distinct results", () => {
    const known = getZipTravelRule("99993", TEST_ZIP_CONFIG);
    const unknown = getZipTravelRule("00000", TEST_ZIP_CONFIG);
    expect(known.configured).toBe(false);
    expect(unknown.configured).toBe(false);
    if (known.configured || unknown.configured) throw new Error("expected both to be unconfigured");
    expect(known.reason).toBe("ZIP_MANUAL_REVIEW_REQUIRED");
    expect(unknown.reason).toBe("ZIP_TRAVEL_NOT_CONFIGURED");
    expect(known).not.toEqual(unknown);
  });
});

// ---------------------------------------------------------------------------
// Production config — converted from the approved
// CleanPerfecto_DFW_ZIP_Travel_Bands_Simple.csv, owner-approved 2026-08-13,
// finalized (all 273 rows, including Manual review) 2026-08-13
// ---------------------------------------------------------------------------

describe("production ZIP_TRAVEL_CONFIG", () => {
  it("contains no duplicate ZIP values", () => {
    const zips = ZIP_TRAVEL_CONFIG.map((rule) => rule.zip);
    expect(new Set(zips).size).toBe(zips.length);
  });

  it("every band is one of the five recognized travel bands", () => {
    const recognized: TravelBand[] = ["core", "nearby", "extended", "outer", "manual_review"];
    for (const rule of ZIP_TRAVEL_CONFIG) {
      expect(recognized).toContain(rule.band);
    }
  });

  it("Core always maps to 0%", () => {
    for (const rule of ZIP_TRAVEL_CONFIG.filter((r) => r.band === "core")) {
      expect(rule.percentage).toBe(0);
    }
  });

  it("Nearby always maps to 3%", () => {
    for (const rule of ZIP_TRAVEL_CONFIG.filter((r) => r.band === "nearby")) {
      expect(rule.percentage).toBe(0.03);
    }
  });

  it("Extended always maps to 6%", () => {
    for (const rule of ZIP_TRAVEL_CONFIG.filter((r) => r.band === "extended")) {
      expect(rule.percentage).toBe(0.06);
    }
  });

  it("Outer always maps to 10%", () => {
    for (const rule of ZIP_TRAVEL_CONFIG.filter((r) => r.band === "outer")) {
      expect(rule.percentage).toBe(0.1);
    }
  });

  it("Manual review ZIPs carry a null percentage — never an invented number", () => {
    for (const rule of ZIP_TRAVEL_CONFIG.filter((r) => r.band === "manual_review")) {
      expect(rule.percentage).toBeNull();
    }
  });

  it("every automatic-band rule's percentage matches TRAVEL_BAND_PERCENTAGES for its band", () => {
    for (const rule of ZIP_TRAVEL_CONFIG) {
      if (rule.band === "manual_review") continue;
      expect(rule.percentage).toBe(TRAVEL_BAND_PERCENTAGES[rule.band as AutomaticTravelBand]);
    }
  });

  it("the base ZIP 75056 resolves to Core / 0%", () => {
    expect(BASE_ZIP).toBe("75056");
    expect(getZipTravelRule(BASE_ZIP)).toEqual({ configured: true, percentage: 0, band: "core" });
  });

  it("repeated lookup of the same ZIP returns the same result (production config)", () => {
    const first = getZipTravelRule("75002");
    const second = getZipTravelRule("75002");
    expect(first).toEqual(second);
    expect(first).toEqual({ configured: true, percentage: 0.06, band: "extended" });
  });

  it("a known Nearby example (75001) resolves correctly", () => {
    expect(getZipTravelRule("75001")).toEqual({ configured: true, percentage: 0.03, band: "nearby" });
  });

  it("a known Extended example (75002) resolves correctly", () => {
    expect(getZipTravelRule("75002")).toEqual({ configured: true, percentage: 0.06, band: "extended" });
  });

  it("a known Core example (75006) resolves correctly", () => {
    expect(getZipTravelRule("75006")).toEqual({ configured: true, percentage: 0, band: "core" });
  });

  it("an Outer example drawn directly from the approved CSV (75032, 37.8 mi) resolves correctly", () => {
    expect(getZipTravelRule("75032")).toEqual({ configured: true, percentage: 0.1, band: "outer" });
  });

  it("a known Manual-review ZIP from the approved CSV (75054, 40.7 mi) returns the distinct known-manual-review result, not an invented percentage", () => {
    expect(getZipTravelRule("75054")).toEqual({
      configured: false,
      reason: "ZIP_MANUAL_REVIEW_REQUIRED",
      band: "manual_review",
    });
  });

  it("a completely unknown ZIP (never present in the approved CSV at all) returns the distinct not-configured result", () => {
    expect(getZipTravelRule("00000")).toEqual({
      configured: false,
      reason: "ZIP_TRAVEL_NOT_CONFIGURED",
    });
  });

  it("known-manual-review and completely-unknown are distinguishable outcomes", () => {
    const knownManualReview = getZipTravelRule("75054"); // in the CSV, band = Manual review
    const completelyUnknown = getZipTravelRule("00000"); // never in the CSV
    if (knownManualReview.configured || completelyUnknown.configured) {
      throw new Error("expected both to be unconfigured");
    }
    expect(knownManualReview.reason).toBe("ZIP_MANUAL_REVIEW_REQUIRED");
    expect(completelyUnknown.reason).toBe("ZIP_TRAVEL_NOT_CONFIGURED");
  });

  it("loads all 273 approved ZIP records (no rows dropped)", () => {
    expect(ZIP_TRAVEL_CONFIG.length).toBe(273);
  });

  it("matches the approved per-band record counts, including all 88 Manual review ZIPs", () => {
    const counts = ZIP_TRAVEL_CONFIG.reduce<Record<string, number>>((acc, rule) => {
      acc[rule.band] = (acc[rule.band] ?? 0) + 1;
      return acc;
    }, {});
    expect(counts).toEqual({ core: 13, nearby: 45, extended: 70, outer: 57, manual_review: 88 });
  });
});
