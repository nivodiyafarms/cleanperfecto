import { describe, expect, it } from "vitest";
import { ACH_SAVINGS_RATE, applyAchIncentive } from "./ach-incentive";

describe("applyAchIncentive", () => {
  it("applies exactly 1% off the card subtotal", () => {
    expect(ACH_SAVINGS_RATE).toBe(0.01);
    const { achSubtotal, achSavingsAmount } = applyAchIncentive(770.63);
    // 770.63 * 0.99 = 762.9237 -> rounded once: 762.92
    expect(achSubtotal).toBe(762.92);
    expect(achSavingsAmount).toBeCloseTo(7.71);
  });

  it("rounds once via the centralized roundToCents, never producing a raw float", () => {
    const { achSubtotal, achSavingsAmount } = applyAchIncentive(700.01);
    expect(Number.isInteger(achSubtotal * 100)).toBe(true);
    expect(Number.isInteger(achSavingsAmount * 100)).toBe(true);
  });

  it("achSubtotal + achSavingsAmount reconstructs the original card subtotal", () => {
    const cardSubtotal = 1048.37;
    const { achSubtotal, achSavingsAmount } = applyAchIncentive(cardSubtotal);
    expect(achSubtotal + achSavingsAmount).toBeCloseTo(cardSubtotal);
  });

  it("never mutates or recomputes the trusted card subtotal itself — only derives a new discounted figure from it", () => {
    const cardSubtotal = 128.44;
    const { achSubtotal } = applyAchIncentive(cardSubtotal);
    expect(achSubtotal).toBeLessThan(cardSubtotal);
  });
});
