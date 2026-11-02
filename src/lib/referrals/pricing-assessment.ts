import { roundToCents } from "@/lib/pricing/money";
import type { CalculationResult } from "@/lib/pricing/types";

export type ReferralDiscountProgram = "none" | "first_cleaning" | "recurring_cycle" | "prepaid_package" | null;

/**
 * What may count toward the $150 referral minimum.
 *
 * service_visit_pricing.base_amount is the customer booking price
 * (booking_orders.calculatedTotal via resolveCustomerBookingPrice, or the
 * recurring scope's approved base). That figure is the estimate-range upper
 * bound or the full calculated total, so it already includes travel,
 * supplies, add-ons, and customization. The invoice builder keeps those
 * lines separate from tax and tip (build-service-visit-invoice.ts): add-ons
 * are add_on_amount, customization that was priced into the quote lives in
 * the snapshot, admin charges are custom_charge_amount, tax and tip live on
 * the payment. None of those may be added back onto the cleaning price.
 *
 * The cleaning price is the snapshot's cleaningSubtotal after the normal
 * recurring-cycle rate, minus dedicated-room customization (special rooms
 * are inside that subtotal). Outdoor, windows, move-package upgrades,
 * priced add-ons, travel, supplies, and outdoor/manual charges the engine
 * excludes from the priced total are outside cleaningSubtotal and stay out.
 */
export interface ReferralPricingAssessmentInput {
  /** service_visit_pricing.pricing_snapshot, a quote/booking { input, result }, or a calculation result. */
  pricingSnapshot?: unknown;
  /** recurring_scope_versions.pricing_snapshot when the visit snapshot only stores recurringScopeVersionId. */
  scopePricingSnapshot?: unknown;
  /** booking_orders.pricing_snapshot when the visit row does not embed it. */
  bookingPricingSnapshot?: unknown;
  /** Fallback only when no calculation result can be found. Never add add-ons, charges, tax, or tips to it. */
  baseAmount?: number;
  addOnAmount?: number;
  customChargeAmount?: number;
  customDiscountAmount?: number;
  customAdjustments?: { type?: string; amount?: number }[];
  prepaidPackageId?: string | null;
  taxAmount?: number;
  tipAmount?: number;
  /** Used only when the snapshot has no calculation result. */
  discountProgram?: ReferralDiscountProgram;
}

export interface ReferralPricingAssessment {
  eligibleCleaningAmount: number;
  stackingBlocked: boolean;
  stackingSignal: "prepaid_package" | "first_cleaning" | "custom_discount" | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function isCalculationResult(value: unknown): value is CalculationResult {
  const record = asRecord(value);
  return record !== null && typeof record.cleaningSubtotal === "number" && typeof record.basePrice === "number";
}

function resultFromSnapshot(snapshot: unknown): CalculationResult | null {
  if (isCalculationResult(snapshot)) return snapshot;
  const record = asRecord(snapshot);
  if (!record) return null;
  if (isCalculationResult(record.result)) return record.result;
  const nestedBooking = asRecord(record.bookingOrderPricingSnapshot);
  if (nestedBooking && isCalculationResult(nestedBooking.result)) return nestedBooking.result;
  return null;
}

/** Walks the snapshot shapes estimate-visit-pricing and the quote/booking flow actually persist. */
export function findCalculationResult(input: ReferralPricingAssessmentInput): CalculationResult | null {
  return (
    resultFromSnapshot(input.pricingSnapshot) ??
    resultFromSnapshot(input.scopePricingSnapshot) ??
    resultFromSnapshot(input.bookingPricingSnapshot)
  );
}

function positive(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function stackingFromResult(result: CalculationResult): ReferralPricingAssessment["stackingSignal"] {
  const program = result.discountProgram;
  const packageDiscount = positive(result.packageDiscount);
  const prepaidTotal = positive(result.prepaidPackageTotal);
  if (program === "prepaid_package" || packageDiscount > 0 || prepaidTotal > 0) return "prepaid_package";
  if (program === "first_cleaning" || positive(result.firstCleaningDiscount) > 0) return "first_cleaning";
  return null;
}

export function assessReferralPricing(input: ReferralPricingAssessmentInput): ReferralPricingAssessment {
  const result = findCalculationResult(input);
  const customLine = (input.customAdjustments ?? []).some(
    (adjustment) => adjustment.type === "custom_discount" && positive(adjustment.amount) > 0
  );
  let stackingSignal: ReferralPricingAssessment["stackingSignal"] = null;
  if (input.prepaidPackageId) stackingSignal = "prepaid_package";
  else if (positive(input.customDiscountAmount) > 0 || customLine) stackingSignal = "custom_discount";
  else if (result) stackingSignal = stackingFromResult(result);
  else if (input.discountProgram === "prepaid_package") stackingSignal = "prepaid_package";
  else if (input.discountProgram === "first_cleaning") stackingSignal = "first_cleaning";

  let eligible = positive(input.baseAmount);
  if (result) {
    const cleaning = positive(result.cleaningSubtotal);
    const specialRoomPortion =
      positive(result.specialRoomChargesTotal) *
      (typeof result.squareFootageMultiplier === "number" ? result.squareFootageMultiplier : 1) *
      (typeof result.conditionMultiplier === "number" ? result.conditionMultiplier : 1);
    const core = cleaning - specialRoomPortion;
    const recurring = positive(result.recurringAdjustment);
    const recurringRateApplies =
      result.discountProgram === "recurring_cycle" &&
      cleaning > 0 &&
      recurring > 0 &&
      positive(result.firstCleaningDiscount) === 0 &&
      positive(result.packageDiscount) === 0;
    eligible = recurringRateApplies ? core * (1 - recurring / cleaning) : core;
  }

  return {
    eligibleCleaningAmount: roundToCents(Math.max(0, eligible)),
    stackingBlocked: stackingSignal !== null,
    stackingSignal,
  };
}
