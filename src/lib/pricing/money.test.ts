import { describe, expect, it } from "vitest";
import { roundToCents } from "./money";

describe("roundToCents", () => {
  it("rounds a sub-cent fraction to the nearest cent (owner worked example: 565.008 -> 565.01)", () => {
    expect(roundToCents(565.008)).toBe(565.01);
  });

  it("rounds the full 6-visit package base total (owner worked example: 700.008 -> 700.01)", () => {
    expect(roundToCents(116.668 * 6)).toBe(700.01);
  });

  it("rounds the package-plus-add-ons total (owner worked example: 840.008 -> 840.01)", () => {
    expect(roundToCents(116.668 * 6 + 140)).toBe(840.01);
  });

  it("eliminates the classic IEEE-754 artifact (400 * 1.1 = 440.00000000000006 -> 440)", () => {
    expect(roundToCents(400 * 1.1)).toBe(440);
  });

  it("leaves an already-exact cent amount unchanged", () => {
    expect(roundToCents(144)).toBe(144);
    expect(roundToCents(99.5)).toBe(99.5);
  });

  it("rounds half-cent values up (standard rounding, not banker's rounding)", () => {
    expect(roundToCents(1.005)).toBe(1.01);
    expect(roundToCents(0.005)).toBe(0.01);
  });

  it("never returns more than 2 decimal places of precision", () => {
    const result = roundToCents(1 / 3);
    expect(Number.isInteger(result * 100)).toBe(true);
  });
});
