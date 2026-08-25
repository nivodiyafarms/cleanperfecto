import { describe, expect, it } from "vitest";
import { InvalidVisitStateError } from "@/lib/scheduling/errors";
import { CUSTOM_TIP_CONFIRMATION_FLAT_THRESHOLD, CUSTOM_TIP_HARD_CEILING, resolveTipAmount } from "./tip-rules";

describe("resolveTipAmount", () => {
  it("computes 15% from the server-side basis", () => {
    const result = resolveTipAmount({ tipSelectionType: "percentage_15", tipBasisAmount: 200 });
    expect(result.tipAmount).toBe(30);
    expect(result.tipPercentage).toBe(15);
    expect(result.requiresConfirmation).toBe(false);
  });

  it("computes 20%", () => {
    expect(resolveTipAmount({ tipSelectionType: "percentage_20", tipBasisAmount: 200 }).tipAmount).toBe(40);
  });

  it("computes 25%", () => {
    expect(resolveTipAmount({ tipSelectionType: "percentage_25", tipBasisAmount: 200 }).tipAmount).toBe(50);
  });

  it("never reads customAmount for a percentage selection, even if supplied — the client cannot forge a percentage's dollar amount", () => {
    const result = resolveTipAmount({ tipSelectionType: "percentage_15", tipBasisAmount: 200, customAmount: 999 });
    expect(result.tipAmount).toBe(30);
  });

  it("Custom $0 is valid", () => {
    const result = resolveTipAmount({ tipSelectionType: "custom", tipBasisAmount: 200, customAmount: 0 });
    expect(result.tipAmount).toBe(0);
    expect(result.requiresConfirmation).toBe(false);
  });

  it("rejects a negative custom amount", () => {
    expect(() => resolveTipAmount({ tipSelectionType: "custom", tipBasisAmount: 200, customAmount: -5 })).toThrow(InvalidVisitStateError);
  });

  it(`rejects a custom amount over the $${CUSTOM_TIP_HARD_CEILING} hard ceiling`, () => {
    expect(() => resolveTipAmount({ tipSelectionType: "custom", tipBasisAmount: 200, customAmount: CUSTOM_TIP_HARD_CEILING + 0.01 })).toThrow(InvalidVisitStateError);
  });

  it("accepts exactly the hard ceiling", () => {
    expect(() => resolveTipAmount({ tipSelectionType: "custom", tipBasisAmount: 200, customAmount: CUSTOM_TIP_HARD_CEILING })).not.toThrow();
  });

  it("requires confirmation when custom tip exceeds 100% of the basis", () => {
    const result = resolveTipAmount({ tipSelectionType: "custom", tipBasisAmount: 100, customAmount: 150 });
    expect(result.requiresConfirmation).toBe(true);
  });

  it(`requires confirmation when custom tip exceeds $${CUSTOM_TIP_CONFIRMATION_FLAT_THRESHOLD} even if under 100% of a large basis`, () => {
    const result = resolveTipAmount({ tipSelectionType: "custom", tipBasisAmount: 1000, customAmount: CUSTOM_TIP_CONFIRMATION_FLAT_THRESHOLD + 1 });
    expect(result.requiresConfirmation).toBe(true);
  });

  it("does not require confirmation at or under both thresholds", () => {
    const result = resolveTipAmount({ tipSelectionType: "custom", tipBasisAmount: 1000, customAmount: 150 });
    expect(result.requiresConfirmation).toBe(false);
  });

  it("presets never require confirmation, even for an unusually large basis", () => {
    const result = resolveTipAmount({ tipSelectionType: "percentage_25", tipBasisAmount: 10000 });
    expect(result.requiresConfirmation).toBe(false);
  });
});
