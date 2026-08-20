import { calculateEstimate } from "@/lib/pricing/calculate-estimate";
import type { AddOnId, CalculationInput, CalculationResult, FrequencyId } from "@/lib/pricing/types";
import type { BookingPricingOptions, PrepaidFrequency } from "./types";

const NORMAL_FREQUENCIES: FrequencyId[] = ["one_time", "weekly", "biweekly", "every_4_weeks"];
const RECURRING_FREQUENCIES: Exclude<FrequencyId, "one_time">[] = ["weekly", "biweekly", "every_4_weeks"];
const PACKAGE_FREQUENCIES: PrepaidFrequency[] = ["weekly", "biweekly", "every_4_weeks"];

/** Owner-approved minimum for a 6+ prepaid package — see discount-program.ts's PACKAGE_MIN_VISITS. */
const PREPAID_VISIT_COUNT = 6;

export interface BuildBookingPricingOptionsParams {
  /** The original quote's own CalculationInput (propertyKind/cleaningType/condition/sizeTier/rooms/squareFeet/zip) — read from quote_requests.pricing_snapshot.input, never re-collected from the customer at booking time. */
  baseInput: CalculationInput;
  /** Freshly resolved at booking time (see checkFirstCleaningEligibility) — never reused verbatim from the original quote, since eligibility can change between quote and booking. */
  firstCleaningEligible: boolean;
  /** Raw add-on ids carried from the quote's post-estimate customization, re-priced here via the trusted catalog. Applied to normal options only — a prepaid package purchase never collects add-ons (see business rule in the approved plan). */
  addOnIds: AddOnId[];
  asOf: Date;
}

/**
 * Pure, no I/O: computes every booking option the customer can choose from
 * in a single pass — 4 normal frequencies (visitCount 1) and 3 prepaid
 * package frequencies (visitCount 6, isPrepaidPackage true) — by calling
 * the trusted calculateEstimate() engine directly. Never reimplements any
 * pricing math. Called once per booking-page render (or per booking
 * creation, to recompute the one chosen option) — cheap enough that no
 * caching or per-tab round trip is needed.
 */
export function buildBookingPricingOptions(params: BuildBookingPricingOptionsParams): BookingPricingOptions {
  const { baseInput, firstCleaningEligible, addOnIds, asOf } = params;

  const normal = {} as Record<FrequencyId, CalculationResult>;
  for (const frequency of NORMAL_FREQUENCIES) {
    normal[frequency] = calculateEstimate({
      ...baseInput,
      frequency,
      isPrepaidPackage: false,
      visitCount: 1,
      addOnIds,
      visitAddOns: undefined,
      firstCleaningEligible,
      asOf,
    });
  }

  // "Future" recurring pricing — the ongoing per-visit price after the
  // first cleaning, when the first-cleaning offer no longer applies. Same
  // trusted calculateEstimate() call as `normal` above with exactly one
  // flag flipped (firstCleaningEligible: false) — never a duplicated
  // formula. Only meaningful for the 3 recurring frequencies; one_time has
  // no "future visit" concept.
  const futureRecurring = {} as Record<Exclude<FrequencyId, "one_time">, CalculationResult>;
  for (const frequency of RECURRING_FREQUENCIES) {
    futureRecurring[frequency] = calculateEstimate({
      ...baseInput,
      frequency,
      isPrepaidPackage: false,
      visitCount: 1,
      addOnIds,
      visitAddOns: undefined,
      firstCleaningEligible: false,
      asOf,
    });
  }

  const packages = {} as Record<PrepaidFrequency, CalculationResult>;
  for (const frequency of PACKAGE_FREQUENCIES) {
    packages[frequency] = calculateEstimate({
      ...baseInput,
      frequency,
      isPrepaidPackage: true,
      visitCount: PREPAID_VISIT_COUNT,
      addOnIds: [],
      visitAddOns: undefined,
      firstCleaningEligible,
      asOf,
    });
  }

  return { normal, futureRecurring, packages };
}
