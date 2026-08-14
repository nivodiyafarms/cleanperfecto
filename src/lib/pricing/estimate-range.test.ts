import { describe, expect, it } from "vitest";
import { buildEstimateRange } from "./estimate-range";

describe("buildEstimateRange — owner worked examples (2026-08-13)", () => {
  it("Example 1 — Light: $129 calculated total displays as $130-$150", () => {
    expect(buildEstimateRange(129, "light", false)).toEqual({ lower: 130, upper: 150 });
  });

  it("Example 2 — Moderate: $179 calculated total displays as $180-$205", () => {
    expect(buildEstimateRange(179, "moderate", false)).toEqual({ lower: 180, upper: 205 });
  });

  it("Example 3 — Heavy: $229 calculated total displays as $230-$260", () => {
    expect(buildEstimateRange(229, "heavy", false)).toEqual({ lower: 230, upper: 260 });
  });

  it("Example 4 — Large Heavy job: $400 calculated total displays as $400-$440 (percentage spread wins)", () => {
    expect(buildEstimateRange(400, "heavy", false)).toEqual({ lower: 400, upper: 440 });
  });

  it("Example 5 — $99 minimum floor: displays as $99-$120, never $100-...", () => {
    expect(buildEstimateRange(99, "light", true)).toEqual({ lower: 99, upper: 120 });
  });

  it("Example 6 — Extensive Deep: $350 calculated total displays as $350-$405", () => {
    expect(buildEstimateRange(350, "extensive", false)).toEqual({ lower: 350, upper: 405 });
  });
});

describe("buildEstimateRange — minimum dollar gaps are floors, not ceilings", () => {
  it("Light gap is never below $20", () => {
    // A tiny total where 5% would produce far less than $20 of spread.
    const result = buildEstimateRange(100, "light", false);
    expect(result.upper - result.lower).toBeGreaterThanOrEqual(20);
  });

  it("Moderate gap is never below $25", () => {
    const result = buildEstimateRange(150, "moderate", false);
    expect(result.upper - result.lower).toBeGreaterThanOrEqual(25);
  });

  it("Heavy gap is never below $30", () => {
    const result = buildEstimateRange(150, "heavy", false);
    expect(result.upper - result.lower).toBeGreaterThanOrEqual(30);
  });

  it("Extensive Deep gap is never below $30", () => {
    const result = buildEstimateRange(150, "extensive", false);
    expect(result.upper - result.lower).toBeGreaterThanOrEqual(30);
  });
});

describe("buildEstimateRange — winner selection", () => {
  it("the minimum dollar spread wins when the percentage spread would be too small (small job)", () => {
    // $130 lower; 5% of 129 ~= $6.45 spread (percentageUpper ~135.45) vs $20 minimum gap (150).
    const result = buildEstimateRange(129, "light", false);
    const percentageSpread = 129 * 0.05;
    const actualSpread = result.upper - result.lower;
    expect(actualSpread).toBeGreaterThan(percentageSpread);
    expect(result.upper).toBe(150);
  });

  it("the percentage spread wins when it produces the larger result (large job)", () => {
    // $400 lower; 10% of 400 = 440 vs 400+30=430 minimum-gap upper. Percentage wins.
    const result = buildEstimateRange(400, "heavy", false);
    expect(result.upper).toBe(440);
    expect(result.upper).toBeGreaterThan(430);
  });
});

describe("buildEstimateRange — bounds", () => {
  it("the lower bound is never below the calculated total", () => {
    for (const total of [99, 100, 101, 144, 179, 204.5, 999]) {
      const result = buildEstimateRange(total, "moderate", false);
      expect(result.lower).toBeGreaterThanOrEqual(total);
    }
  });

  it("ordinary lower bounds round upward to the next $5", () => {
    expect(buildEstimateRange(129, "light", false).lower).toBe(130);
    expect(buildEstimateRange(179, "light", false).lower).toBe(180);
    expect(buildEstimateRange(204, "light", false).lower).toBe(205);
    expect(buildEstimateRange(400, "light", false).lower).toBe(400); // already a multiple of $5
  });

  it("upper bounds round upward to the next $5", () => {
    const result = buildEstimateRange(129, "light", false);
    expect(result.upper % 5).toBe(0);
  });

  it("preserves exactly $99 as the lower bound when the $99 floor rule produced the total", () => {
    const result = buildEstimateRange(99, "moderate", true);
    expect(result.lower).toBe(99);
  });

  it("never displays a range lower bound below $99", () => {
    const result = buildEstimateRange(50, "light", false);
    expect(result.lower).toBeGreaterThanOrEqual(99);
  });
});

describe("buildEstimateRange — purity", () => {
  it("does not mutate its inputs and returns a fresh object each call", () => {
    const first = buildEstimateRange(179, "moderate", false);
    const second = buildEstimateRange(179, "moderate", false);
    expect(first).toEqual(second);
    expect(first).not.toBe(second);
  });

  it("is a pure function of its three arguments — the underlying authoritative total is never referenced or altered by this module", () => {
    const totalBefore = 229;
    const range = buildEstimateRange(totalBefore, "heavy", false);
    expect(totalBefore).toBe(229); // unchanged — range is presentation-only
    expect(range).toEqual({ lower: 230, upper: 260 });
  });
});
