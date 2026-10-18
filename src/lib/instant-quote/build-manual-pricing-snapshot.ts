import { ADD_ON_CATALOG } from "@/lib/pricing/add-ons";
import { roundToCents } from "@/lib/pricing/money";
import type { AddOnId, CalculationInput, CalculationResult, ManualQuoteAddOnResult } from "@/lib/pricing/types";

/**
 * Distinct from the real engine's PRICING_VERSION (src/lib/pricing/config.ts)
 * so every admin-priced row is trivially filterable later — no new column
 * or JSON marker key is needed to tell an agreed quote apart from an
 * ordinary instant quote.
 */
export const MANUAL_PRICING_VERSION = "manual-agreed-v1";

export interface ManualPricingSnapshotInput {
  calculationInput: CalculationInput;
  /** The admin's exact negotiated figure — must be > 0. For a prepaid package, this is the full package total (not a per-visit amount). */
  agreedTotal: number;
  /** Add-ons the admin records as part of the agreed scope — informational only, never individually priced (see manualQuoteAddOns below). */
  scopeAddOnIds: AddOnId[];
  asOf: Date;
}

function toManualQuoteAddOns(ids: AddOnId[]): ManualQuoteAddOnResult[] {
  return ids.map((id) => ({ id, label: ADD_ON_CATALOG[id].label }));
}

/**
 * Builds a CalculationResult representing an admin-agreed price WITHOUT
 * running it through calculateEstimate — the defining property of an agreed
 * quote is that the price is preserved exactly as negotiated, never
 * recalculated or silently overridden. Every line item collapses into one
 * internally-consistent sum equal to agreedTotal, rather than a fabricated
 * decomposition, so any downstream code that reconstructs a subtotal from
 * parts never produces a number that disagrees with the headline total.
 *
 * Two invariants are REQUIRED, not stylistic: estimateType "instant-range"
 * and manualReviewRequired/manualReviewReasons empty — getQuoteForBooking's
 * bookability check rejects anything else, which would silently defeat this
 * entire feature. discountProgram is "none" because no discount rule
 * actually produced this number — attributing it to first_cleaning/
 * recurring_cycle/prepaid_package would misrepresent how the price was set.
 */
export function buildManualPricingSnapshot(input: ManualPricingSnapshotInput): CalculationResult {
  const { calculationInput, agreedTotal, scopeAddOnIds, asOf } = input;
  const isPrepaidPackage = calculationInput.isPrepaidPackage;
  const total = roundToCents(agreedTotal);

  return {
    estimateType: "instant-range",
    pricingVersion: MANUAL_PRICING_VERSION,
    calculatedAt: asOf.toISOString(),

    propertyKind: calculationInput.propertyKind,
    cleaningType: calculationInput.cleaningType,
    condition: calculationInput.condition,
    sizeTier: calculationInput.sizeTier,

    basePrice: total,

    roomAdjustments: 0,
    roomAdjustmentConfigured: true,

    specialRoomCharges: [],
    specialRoomChargesTotal: 0,
    specialRoomsConfigured: true,

    squareFootageMultiplier: 1,
    squareFootageConfigured: true,

    conditionMultiplier: 1,

    cleaningSubtotal: total,

    frequency: calculationInput.frequency,
    visitCount: calculationInput.visitCount,
    discountProgram: "none",
    recurringAdjustment: 0,
    packageDiscount: 0,

    travelPercentage: null,
    travelCharge: 0,
    travelConfigured: true,

    suppliesEquipmentCharge: 0,
    suppliesEquipmentConfigured: true,

    pricedAddOns: [],
    pricedAddOnsTotal: 0,
    manualQuoteAddOns: isPrepaidPackage ? [] : toManualQuoteAddOns(scopeAddOnIds),

    packageAddOnsTotal: 0,
    packagePricedAddOns: [],
    packageManualQuoteAddOns: isPrepaidPackage ? toManualQuoteAddOns(scopeAddOnIds) : [],

    quantifiedAddOns: [],
    quantifiedAddOnsTotal: 0,

    movePackageLevel: calculationInput.cleaningType === "move" ? (calculationInput.movePackageLevel ?? "basic") : null,
    moveDirection: calculationInput.cleaningType === "move" ? (calculationInput.moveDirection ?? null) : null,
    moveEquivalentDeepTotal: null,
    moveFloorApplied: null,
    moveCompleteUpgrade: null,
    moveCompleteUpgradeConfigured: null,
    includedByCompletePackage: [],
    completePackageRecommended: false,

    outdoorCharges: [],
    outdoorChargesTotal: 0,
    outdoorManualCharges: [],

    activeFirstCleaningOfferPercent: null,
    firstCleaningEligible: calculationInput.firstCleaningEligible,
    firstCleaningDiscount: 0,

    preDiscountTotal: total,
    calculatedTotal: total,

    hasStartingAtPricing: false,

    prepaidPackageTotal: isPrepaidPackage ? total : null,
    effectivePricePerVisit: isPrepaidPackage ? roundToCents(total / calculationInput.visitCount) : null,

    minimumServiceTotalApplied: false,

    range: { lower: total, upper: total },

    recommendedService: null,

    manualReviewRequired: false,
    manualReviewReasons: [],
  };
}
