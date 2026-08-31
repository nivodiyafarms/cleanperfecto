import { describe, expect, it } from "vitest";
import { getMoveCompleteUpgrade, MOVE_COMPLETE_UPGRADE_CONFIG } from "./move-package";

describe("getMoveCompleteUpgrade", () => {
  it.each([
    { sqFt: 1500, expected: 50 },
    { sqFt: 1501, expected: 65 },
    { sqFt: 2500, expected: 65 },
    { sqFt: 2501, expected: 80 },
    { sqFt: 3500, expected: 80 },
    { sqFt: 3501, expected: 100 },
    { sqFt: 4500, expected: 100 },
  ])("$sqFt sq ft resolves to +$$expected", ({ sqFt, expected }) => {
    const result = getMoveCompleteUpgrade(sqFt);
    expect(result).toEqual({ configured: true, amount: expected });
  });

  it("4501 sq ft requires a custom/manual Complete quote rather than an invented amount", () => {
    const result = getMoveCompleteUpgrade(4501);
    expect(result).toEqual({ configured: false, reason: "MOVE_COMPLETE_UPGRADE_NOT_CONFIGURED" });
  });

  it("a tiny property (well under the first band) still resolves to the first band's amount", () => {
    expect(getMoveCompleteUpgrade(500)).toEqual({ configured: true, amount: 50 });
  });

  it("uses an injected config rather than the production table when provided", () => {
    const testConfig = [{ maxSqFt: 1000, amount: 10 }];
    expect(getMoveCompleteUpgrade(900, testConfig)).toEqual({ configured: true, amount: 10 });
    expect(getMoveCompleteUpgrade(1001, testConfig)).toEqual({
      configured: false,
      reason: "MOVE_COMPLETE_UPGRADE_NOT_CONFIGURED",
    });
  });

  it("production config matches the approved bands exactly", () => {
    expect(MOVE_COMPLETE_UPGRADE_CONFIG).toEqual([
      { maxSqFt: 1500, amount: 50 },
      { maxSqFt: 2500, amount: 65 },
      { maxSqFt: 3500, amount: 80 },
      { maxSqFt: 4500, amount: 100 },
    ]);
  });
});
