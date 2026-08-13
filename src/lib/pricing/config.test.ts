import { describe, expect, it } from "vitest";
import { RANGE_MULTIPLIERS } from "./config";

describe("RANGE_MULTIPLIERS", () => {
  it("uses exactly +7% for Moderate condition (owner-confirmed 2026-08-12, supersedes an earlier +5% mention)", () => {
    expect(RANGE_MULTIPLIERS.moderate).toBe(1.07);
  });

  it("matches the full approved range table", () => {
    expect(RANGE_MULTIPLIERS).toEqual({
      light: 1.05,
      moderate: 1.07,
      heavy: 1.1,
      extensive: 1.15,
    });
  });
});
