import { describe, expect, it } from "vitest";
import { getZipTravelRule, type ZipTravelRule } from "./zip-travel";

// TEST-ONLY fixtures — must never be copied into production config.
const TEST_ZIP_CONFIG: ZipTravelRule[] = [
  { zip: "99991", percentage: 0.05, band: "close" },
  { zip: "99992", percentage: 0.12, band: "extended" },
];

describe("getZipTravelRule", () => {
  it("returns the identical percentage for the same ZIP every time", () => {
    const first = getZipTravelRule("99991", TEST_ZIP_CONFIG);
    const second = getZipTravelRule("99991", TEST_ZIP_CONFIG);
    const third = getZipTravelRule("99991", TEST_ZIP_CONFIG);

    expect(first).toEqual({ configured: true, percentage: 0.05, band: "close" });
    expect(second).toEqual(first);
    expect(third).toEqual(first);
  });

  it("resolves different configured ZIPs to their own fixed percentage", () => {
    expect(getZipTravelRule("99992", TEST_ZIP_CONFIG)).toEqual({
      configured: true,
      percentage: 0.12,
      band: "extended",
    });
  });

  it("returns a typed manual-review reason for an unconfigured ZIP", () => {
    expect(getZipTravelRule("00000", TEST_ZIP_CONFIG)).toEqual({
      configured: false,
      reason: "ZIP_TRAVEL_NOT_CONFIGURED",
    });
  });

  it("production ZIP_TRAVEL_CONFIG is empty until an approved table is supplied", async () => {
    const { ZIP_TRAVEL_CONFIG } = await import("./zip-travel");
    expect(ZIP_TRAVEL_CONFIG).toEqual([]);
  });

  it("defaults to the (empty) production config when none is injected", () => {
    expect(getZipTravelRule("99991")).toEqual({
      configured: false,
      reason: "ZIP_TRAVEL_NOT_CONFIGURED",
    });
  });
});
