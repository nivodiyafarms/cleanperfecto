import { describe, expect, it } from "vitest";
import { chooseCleaningServiceDiscount } from "./discount-program";

describe("chooseCleaningServiceDiscount", () => {
  it("applies no discount for a one-time, ineligible customer", () => {
    const result = chooseCleaningServiceDiscount({
      cleaningSubtotal: 200,
      frequency: "one_time",
      isPrepaidPackage: false,
      visitCount: 1,
      activeFirstCleaningOfferPercent: null,
    });
    expect(result).toEqual({
      discountProgram: "none",
      recurringAdjustment: 0,
      packageDiscount: 0,
      firstCleaningDiscount: 0,
    });
  });

  it("applies the first-cleaning offer alone for a one-time, eligible customer (scenario A)", () => {
    const result = chooseCleaningServiceDiscount({
      cleaningSubtotal: 200,
      frequency: "one_time",
      isPrepaidPackage: false,
      visitCount: 1,
      activeFirstCleaningOfferPercent: 30,
    });
    expect(result).toEqual({
      discountProgram: "first_cleaning",
      recurringAdjustment: 0,
      packageDiscount: 0,
      firstCleaningDiscount: 60,
    });
  });

  it("applies plain recurring-cycle pricing for a non-eligible recurring customer", () => {
    const weekly = chooseCleaningServiceDiscount({
      cleaningSubtotal: 200,
      frequency: "weekly",
      isPrepaidPackage: false,
      visitCount: 1,
      activeFirstCleaningOfferPercent: null,
    });
    expect(weekly.discountProgram).toBe("recurring_cycle");
    expect(weekly.recurringAdjustment).toBeCloseTo(42); // 21% of 200
    expect(weekly.packageDiscount).toBe(0);
    expect(weekly.firstCleaningDiscount).toBe(0);

    const biweekly = chooseCleaningServiceDiscount({
      cleaningSubtotal: 200,
      frequency: "biweekly",
      isPrepaidPackage: false,
      visitCount: 1,
      activeFirstCleaningOfferPercent: null,
    });
    expect(biweekly.recurringAdjustment).toBeCloseTo(28); // 14% of 200

    const monthly = chooseCleaningServiceDiscount({
      cleaningSubtotal: 200,
      frequency: "every_4_weeks",
      isPrepaidPackage: false,
      visitCount: 1,
      activeFirstCleaningOfferPercent: null,
    });
    expect(monthly.recurringAdjustment).toBeCloseTo(14); // 7% of 200
  });

  it("picks the first-cleaning offer over recurring pricing when it is the bigger discount, and does not combine them (scenario B)", () => {
    // 30% first-cleaning (60) beats 21% weekly recurring (42) on $200.
    const result = chooseCleaningServiceDiscount({
      cleaningSubtotal: 200,
      frequency: "weekly",
      isPrepaidPackage: false,
      visitCount: 1,
      activeFirstCleaningOfferPercent: 30,
    });
    expect(result).toEqual({
      discountProgram: "first_cleaning",
      recurringAdjustment: 0,
      packageDiscount: 0,
      firstCleaningDiscount: 60,
    });
  });

  it("picks recurring pricing over the first-cleaning offer when recurring is the bigger discount, and does not combine them (scenario B, synthetic percentage)", () => {
    // Synthetic 10% "offer" (not a real approved value) proves the
    // comparison logic itself, independent of the real 30%/25% constants —
    // under current approved percentages the first-cleaning offer always
    // wins in practice, so this branch needs an artificial input to exercise.
    const result = chooseCleaningServiceDiscount({
      cleaningSubtotal: 200,
      frequency: "weekly",
      isPrepaidPackage: false,
      visitCount: 1,
      activeFirstCleaningOfferPercent: 10,
    });
    expect(result.discountProgram).toBe("recurring_cycle");
    expect(result.recurringAdjustment).toBeCloseTo(42);
    expect(result.packageDiscount).toBe(0);
    expect(result.firstCleaningDiscount).toBe(0);
  });

  it("applies recurring-cycle pricing (not the package discount) for fewer than 6 visits even when prepaid", () => {
    const result = chooseCleaningServiceDiscount({
      cleaningSubtotal: 200,
      frequency: "weekly",
      isPrepaidPackage: true,
      visitCount: 5,
      activeFirstCleaningOfferPercent: null,
    });
    expect(result.discountProgram).toBe("recurring_cycle");
    expect(result.packageDiscount).toBe(0);
  });

  it("applies recurring-cycle pricing (not the package discount) for 6+ visits that are not prepaid", () => {
    const result = chooseCleaningServiceDiscount({
      cleaningSubtotal: 200,
      frequency: "weekly",
      isPrepaidPackage: false,
      visitCount: 8,
      activeFirstCleaningOfferPercent: null,
    });
    expect(result.discountProgram).toBe("recurring_cycle");
    expect(result.packageDiscount).toBe(0);
  });

  it("applies the sequential 10% prepaid-package discount at exactly 6 scheduled and prepaid visits", () => {
    const result = chooseCleaningServiceDiscount({
      cleaningSubtotal: 200,
      frequency: "weekly",
      isPrepaidPackage: true,
      visitCount: 6,
      activeFirstCleaningOfferPercent: null,
    });
    // afterRecurring = 200 * 0.79 = 158; afterPackage = 158 * 0.90 = 142.2
    expect(result.discountProgram).toBe("prepaid_package");
    expect(result.recurringAdjustment).toBeCloseTo(42); // 200 - 158
    expect(result.packageDiscount).toBeCloseTo(15.8); // 158 - 142.2
  });

  it("applies the prepaid-package discount for more than 6 scheduled and prepaid visits", () => {
    const result = chooseCleaningServiceDiscount({
      cleaningSubtotal: 200,
      frequency: "biweekly",
      isPrepaidPackage: true,
      visitCount: 10,
      activeFirstCleaningOfferPercent: null,
    });
    expect(result.discountProgram).toBe("prepaid_package");
    // afterRecurring = 200 * 0.86 = 172; afterPackage = 172 * 0.90 = 154.8
    expect(result.recurringAdjustment).toBeCloseTo(28);
    expect(result.packageDiscount).toBeCloseTo(17.2);
  });

  it("never applies the first-cleaning offer on top of a 6+ prepaid package, even when eligible", () => {
    const result = chooseCleaningServiceDiscount({
      cleaningSubtotal: 200,
      frequency: "weekly",
      isPrepaidPackage: true,
      visitCount: 6,
      activeFirstCleaningOfferPercent: 30,
    });
    expect(result.discountProgram).toBe("prepaid_package");
    expect(result.firstCleaningDiscount).toBe(0);
  });

  it("does not simply add the recurring and package percentages together", () => {
    const result = chooseCleaningServiceDiscount({
      cleaningSubtotal: 100,
      frequency: "weekly",
      isPrepaidPackage: true,
      visitCount: 6,
      activeFirstCleaningOfferPercent: null,
    });
    const totalDiscount = result.recurringAdjustment + result.packageDiscount;
    // Naive additive stacking (21% + 10% = 31%) would give 31; sequential
    // multiplication (0.79 * 0.90 = 0.711) gives 28.9.
    expect(totalDiscount).toBeCloseTo(28.9);
    expect(totalDiscount).not.toBeCloseTo(31);
  });
});
