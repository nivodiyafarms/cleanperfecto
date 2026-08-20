import { PACKAGE_DISCOUNT_MULTIPLIER, PACKAGE_MIN_VISITS, RECURRING_MULTIPLIERS } from "./config";
import type { DiscountProgram, FrequencyId } from "./types";

export interface DiscountProgramInput {
  cleaningSubtotal: number;
  frequency: FrequencyId;
  isPrepaidPackage: boolean;
  visitCount: number;
  /** Null when the customer is not first-cleaning eligible. */
  activeFirstCleaningOfferPercent: number | null;
}

export interface DiscountProgramResult {
  discountProgram: DiscountProgram;
  recurringAdjustment: number;
  packageDiscount: number;
  firstCleaningDiscount: number;
}

/**
 * Selects which discount program applies to the cleaning-service portion of
 * the subtotal, per the owner-approved stacking rule (2026-08-12): the
 * first-cleaning offer and recurring-cycle pricing are never combined — on a
 * customer's first visit, whichever benefits them more wins. A 6+ scheduled
 * AND prepaid package always uses recurring-cycle pricing followed by an
 * additional 10% package discount (owner-approved 2026-08-19, was 20%;
 * sequential, not additive), and never the first-cleaning offer.
 *
 * Given the currently approved percentages (30%/25% first-cleaning vs a max
 * 21% weekly recurring rate), the first-cleaning offer always wins in
 * practice — the "recurring wins" branch exists for correctness and is
 * exercised directly in discount-program.test.ts with synthetic percentages,
 * independent of the real production constants.
 */
export function chooseCleaningServiceDiscount(input: DiscountProgramInput): DiscountProgramResult {
  const { cleaningSubtotal, frequency, isPrepaidPackage, visitCount, activeFirstCleaningOfferPercent } =
    input;
  const isRecurring = frequency !== "one_time";
  const recurringMultiplier = isRecurring ? RECURRING_MULTIPLIERS[frequency] : undefined;

  if (
    isRecurring &&
    isPrepaidPackage &&
    visitCount >= PACKAGE_MIN_VISITS &&
    recurringMultiplier !== undefined
  ) {
    const afterRecurring = cleaningSubtotal * recurringMultiplier;
    const afterPackage = afterRecurring * PACKAGE_DISCOUNT_MULTIPLIER;
    return {
      discountProgram: "prepaid_package",
      recurringAdjustment: cleaningSubtotal - afterRecurring,
      packageDiscount: afterRecurring - afterPackage,
      firstCleaningDiscount: 0,
    };
  }

  if (isRecurring && recurringMultiplier !== undefined) {
    const recurringDiscountAmount = cleaningSubtotal * (1 - recurringMultiplier);
    const firstCleaningDiscountAmount =
      activeFirstCleaningOfferPercent !== null
        ? cleaningSubtotal * (activeFirstCleaningOfferPercent / 100)
        : 0;

    if (activeFirstCleaningOfferPercent !== null && firstCleaningDiscountAmount >= recurringDiscountAmount) {
      return {
        discountProgram: "first_cleaning",
        recurringAdjustment: 0,
        packageDiscount: 0,
        firstCleaningDiscount: firstCleaningDiscountAmount,
      };
    }

    return {
      discountProgram: "recurring_cycle",
      recurringAdjustment: recurringDiscountAmount,
      packageDiscount: 0,
      firstCleaningDiscount: 0,
    };
  }

  if (activeFirstCleaningOfferPercent !== null) {
    return {
      discountProgram: "first_cleaning",
      recurringAdjustment: 0,
      packageDiscount: 0,
      firstCleaningDiscount: cleaningSubtotal * (activeFirstCleaningOfferPercent / 100),
    };
  }

  return { discountProgram: "none", recurringAdjustment: 0, packageDiscount: 0, firstCleaningDiscount: 0 };
}
