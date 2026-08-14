import { getActiveFirstCleaningOffer } from "@/lib/offers/first-cleaning-offer";
import { classifyAddOns } from "./add-ons";
import { BASE_PRICES, CONDITION_MULTIPLIERS, MINIMUM_SERVICE_TOTAL, MOVE_BASE_PRICE, PRICING_VERSION } from "./config";
import { chooseCleaningServiceDiscount } from "./discount-program";
import { buildEstimateRange } from "./estimate-range";
import { roundToCents } from "./money";
import { getRoomAdjustment, ROOM_ADJUSTMENT_CONFIG, type RoomAdjustmentConfig } from "./room-adjustments";
import {
  getSquareFootageMultiplier,
  resolveDefaultSquareFeet,
  SQUARE_FOOTAGE_CONFIG,
  type SquareFootageBand,
} from "./square-footage";
import {
  AIRBNB_SUPPLIES_CONFIG,
  getAirbnbSuppliesCharge,
  getSuppliesEquipmentCharge,
  SUPPLIES_EQUIPMENT_CONFIG,
  type AirbnbSuppliesRule,
  type SuppliesEquipmentRule,
} from "./supplies-equipment";
import type { CalculationInput, CalculationResult, ManualReviewReasonCode } from "./types";
import { getZipTravelRule, ZIP_TRAVEL_CONFIG, type ZipTravelRule } from "./zip-travel";

/** Injectable config bundle — defaults to production config; tests override with isolated fixtures. */
export interface PricingConfigOverrides {
  zipTravelConfig?: ZipTravelRule[];
  suppliesEquipmentConfig?: SuppliesEquipmentRule[];
  airbnbSuppliesConfig?: AirbnbSuppliesRule[];
  squareFootageConfig?: SquareFootageBand[];
  roomAdjustmentConfig?: RoomAdjustmentConfig;
}

function manualReviewResult(
  input: CalculationInput,
  reasons: ManualReviewReasonCode[],
  recommendedService: CalculationResult["recommendedService"] = null
): CalculationResult {
  return {
    estimateType: "manual-review",
    pricingVersion: PRICING_VERSION,
    calculatedAt: input.asOf.toISOString(),
    propertyKind: input.propertyKind,
    cleaningType: input.cleaningType,
    condition: input.condition,
    sizeTier: input.sizeTier,
    basePrice: 0,
    roomAdjustments: 0,
    roomAdjustmentConfigured: true,
    squareFootageMultiplier: 1,
    squareFootageConfigured: true,
    conditionMultiplier: 0,
    cleaningSubtotal: 0,
    frequency: input.frequency,
    visitCount: input.visitCount,
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
    manualQuoteAddOns: [],
    packageAddOnsTotal: 0,
    packagePricedAddOns: [],
    packageManualQuoteAddOns: [],
    activeFirstCleaningOfferPercent: null,
    firstCleaningEligible: input.firstCleaningEligible,
    firstCleaningDiscount: 0,
    preDiscountTotal: 0,
    calculatedTotal: 0,
    hasStartingAtPricing: false,
    prepaidPackageTotal: null,
    effectivePricePerVisit: null,
    minimumServiceTotalApplied: false,
    range: null,
    recommendedService,
    manualReviewRequired: true,
    manualReviewReasons: reasons,
  };
}

/**
 * Pure, deterministic pricing calculation. No React, no Supabase, no
 * network, no ambient clock — `input.asOf` drives every time-dependent
 * decision (matching src/lib/offers/first-cleaning-offer.ts's own pattern).
 * Same inputs always produce the same result.
 *
 * The client may collect inputs and render a provisional display, but this
 * function — called server-side — is always the authoritative calculation.
 * Nothing here accepts a client-submitted total, discount, or multiplier;
 * CalculationInput has no such fields, so there is nothing to override.
 */
export function calculateEstimate(
  input: CalculationInput,
  overrides: PricingConfigOverrides = {}
): CalculationResult {
  // Commercial properties are always manual quote — never a fabricated instant price.
  if (input.propertyKind === "commercial") {
    return manualReviewResult(input, ["COMMERCIAL_PROPERTY"]);
  }

  // Standard Cleaning has no Extensive tier — Deep Cleaning is required.
  if (input.cleaningType === "standard" && input.condition === "extensive") {
    return manualReviewResult(input, ["CONDITION_NOT_AVAILABLE_FOR_SERVICE"], "deep");
  }

  const conditionMultiplier = CONDITION_MULTIPLIERS[input.cleaningType][input.condition];
  if (conditionMultiplier === undefined) {
    // Defensive: every reachable (cleaningType, condition) pair besides
    // Standard+Extensive above has a configured multiplier today; this
    // guards against a future enum value being wired in without one.
    return manualReviewResult(input, ["CONDITION_NOT_AVAILABLE_FOR_SERVICE"]);
  }

  const basePrice =
    input.cleaningType === "move" ? MOVE_BASE_PRICE : BASE_PRICES[input.cleaningType][input.sizeTier];

  const manualReviewReasons: ManualReviewReasonCode[] = [];

  const roomAdjustmentConfig = overrides.roomAdjustmentConfig ?? ROOM_ADJUSTMENT_CONFIG;
  const roomAdjustmentResult = getRoomAdjustment(
    input.cleaningType,
    input.sizeTier,
    input.rooms,
    roomAdjustmentConfig
  );
  const roomAdjustmentConfigured = roomAdjustmentResult.configured;
  const roomAdjustments = roomAdjustmentResult.configured ? roomAdjustmentResult.amount : 0;
  if (!roomAdjustmentResult.configured) {
    manualReviewReasons.push(roomAdjustmentResult.reason);
  }

  const squareFootageConfig = overrides.squareFootageConfig ?? SQUARE_FOOTAGE_CONFIG;

  let squareFootageMultiplier = 1;
  let squareFootageConfigured = true;
  if (input.squareFeet !== undefined) {
    const sqftResult = getSquareFootageMultiplier(input.sizeTier, input.squareFeet, squareFootageConfig);
    if (sqftResult.configured) {
      squareFootageMultiplier = sqftResult.multiplier;
    } else {
      squareFootageConfigured = false;
      manualReviewReasons.push(sqftResult.reason);
    }
  }

  const cleaningSubtotal = (basePrice + roomAdjustments) * squareFootageMultiplier * conditionMultiplier;

  const activeOffer = input.firstCleaningEligible ? getActiveFirstCleaningOffer(input.asOf) : null;
  const activeFirstCleaningOfferPercent = activeOffer?.percent ?? null;

  const discountSelection = chooseCleaningServiceDiscount({
    cleaningSubtotal,
    frequency: input.frequency,
    isPrepaidPackage: input.isPrepaidPackage,
    visitCount: input.visitCount,
    activeFirstCleaningOfferPercent,
  });
  const discountProgram = discountSelection.discountProgram;
  let recurringAdjustment = discountSelection.recurringAdjustment;
  let packageDiscount = discountSelection.packageDiscount;
  let firstCleaningDiscount = discountSelection.firstCleaningDiscount;

  const zipTravelConfig = overrides.zipTravelConfig ?? ZIP_TRAVEL_CONFIG;
  const travelResult = getZipTravelRule(input.zip, zipTravelConfig);
  const travelConfigured = travelResult.configured;
  const travelPercentage = travelResult.configured ? travelResult.percentage : null;
  const travelCharge = travelResult.configured ? cleaningSubtotal * travelResult.percentage : 0;
  if (!travelResult.configured) {
    manualReviewReasons.push(travelResult.reason);
  }

  // Supplies/equipment is banded by square footage, not size tier — use the
  // customer's actual square footage when given, otherwise fall back to the
  // size tier's own included allowance (never an invented number). Airbnb
  // has its own sq-ft-only schedule, independent of the selected cleaning
  // type — see AIRBNB_SUPPLIES_CONFIG.
  const suppliesEquipmentConfig = overrides.suppliesEquipmentConfig ?? SUPPLIES_EQUIPMENT_CONFIG;
  const airbnbSuppliesConfig = overrides.airbnbSuppliesConfig ?? AIRBNB_SUPPLIES_CONFIG;
  const effectiveSquareFeet = input.squareFeet ?? resolveDefaultSquareFeet(input.sizeTier, squareFootageConfig);
  const suppliesResult: ReturnType<typeof getSuppliesEquipmentCharge> =
    effectiveSquareFeet === null
      ? { configured: false, reason: "SUPPLIES_EQUIPMENT_NOT_CONFIGURED" }
      : input.propertyKind === "airbnb"
        ? getAirbnbSuppliesCharge(effectiveSquareFeet, airbnbSuppliesConfig)
        : getSuppliesEquipmentCharge(input.cleaningType, effectiveSquareFeet, suppliesEquipmentConfig);
  const suppliesEquipmentConfigured = suppliesResult.configured;
  const suppliesEquipmentCharge = suppliesResult.configured ? suppliesResult.amount : 0;
  if (!suppliesResult.configured) {
    manualReviewReasons.push(suppliesResult.reason);
  }

  // Add-ons belong to INDIVIDUAL VISITS, owner-approved 2026-08-13. A
  // prepaid package has no single "once per quote" add-on charge — each of
  // its visits may carry its own selection, and the same add-on chosen on
  // two different visits must count twice, never inferred, never
  // multiplied across every visit automatically. `addOnIds` (a single flat
  // list) only has a valid meaning for a one-off request; for a package,
  // per-visit assignment comes from `visitAddOns` instead — see
  // packageAddOnsTotal/packageManualQuoteAddOns below.
  const isPackage = discountProgram === "prepaid_package";

  let pricedAddOns: CalculationResult["pricedAddOns"] = [];
  let pricedAddOnsTotal = 0;
  let manualQuoteAddOns: CalculationResult["manualQuoteAddOns"] = [];
  let packageAddOnsTotal = 0;
  const packageManualQuoteAddOns: CalculationResult["packageManualQuoteAddOns"] = [];
  const packagePricedAddOns: CalculationResult["packagePricedAddOns"] = [];

  if (isPackage) {
    const visitAddOns = input.visitAddOns;
    if (visitAddOns && visitAddOns.length > 0) {
      visitAddOns.forEach((addOnIdsForVisit, index) => {
        const visitNumber = index + 1;
        const classified = classifyAddOns(addOnIdsForVisit);
        packageAddOnsTotal += classified.pricedTotal;
        // Keep each visit's own priced add-ons — including pricingKind —
        // rather than collapsing to a bare number. Losing "starting_at"
        // here would let a non-guaranteed estimate masquerade as an exact
        // payable total once summed into packageAddOnsTotal/prepaidPackageTotal.
        for (const priced of classified.priced) {
          packagePricedAddOns.push({ ...priced, visitNumber });
        }
        for (const manual of classified.manual) {
          packageManualQuoteAddOns.push({ ...manual, visitNumber });
        }
      });
      if (packageManualQuoteAddOns.length > 0) {
        manualReviewReasons.push("MANUAL_QUOTE_ADD_ON_SELECTED");
      }
    } else if (input.addOnIds.length > 0) {
      // Add-ons were submitted but there's no visit assignment to attribute
      // them to — the engine never infers which visit(s) receive them.
      manualReviewReasons.push("ADD_ON_VISIT_ASSIGNMENT_REQUIRED");
    }
  } else {
    const classified = classifyAddOns(input.addOnIds);
    pricedAddOns = classified.priced;
    pricedAddOnsTotal = classified.pricedTotal;
    manualQuoteAddOns = classified.manual;
    if (manualQuoteAddOns.length > 0) {
      manualReviewReasons.push("MANUAL_QUOTE_ADD_ON_SELECTED");
    }
  }

  // True whenever any add-on contributing to the returned total(s) is
  // "starting_at" rather than "fixed" — a caller (future UI/payment code)
  // must check this before treating calculatedTotal/preDiscountTotal (or,
  // for a package, prepaidPackageTotal/effectivePricePerVisit) as an
  // authoritative guaranteed payable amount. A starting-at minimum is a
  // floor, not a promise.
  const hasStartingAtPricing = isPackage
    ? packagePricedAddOns.some((addOn) => addOn.pricingKind === "starting_at")
    : pricedAddOns.some((addOn) => addOn.pricingKind === "starting_at");

  const preDiscountTotal = cleaningSubtotal + travelCharge + suppliesEquipmentCharge + pricedAddOnsTotal;

  // $99 minimum enforcement — a hard backend rule, not display logic. The
  // discount actually applied is capped so the final total never drops
  // below MINIMUM_SERVICE_TOTAL.
  const requestedDiscountTotal = firstCleaningDiscount + recurringAdjustment + packageDiscount;
  const maximumAllowedDiscount = Math.max(0, preDiscountTotal - MINIMUM_SERVICE_TOTAL);
  const actualDiscountTotal = Math.max(0, Math.min(requestedDiscountTotal, maximumAllowedDiscount));
  const minimumServiceTotalApplied = actualDiscountTotal < requestedDiscountTotal;

  if (minimumServiceTotalApplied && requestedDiscountTotal > 0) {
    // Scale every contributing component down by the same ratio so the
    // returned breakdown stays internally consistent with calculatedTotal
    // (relevant only for the two-part prepaid-package discount; the other
    // programs contribute a single component).
    const scale = actualDiscountTotal / requestedDiscountTotal;
    firstCleaningDiscount *= scale;
    recurringAdjustment *= scale;
    packageDiscount *= scale;
  }

  // Raw (unrounded) per-visit price — kept at full precision because it
  // feeds the package-total multiplication below; rounding it first would
  // compound cent-level error across visitCount. calculatedTotal (the
  // public field) is the rounded, authoritative version of this same
  // figure. In package mode pricedAddOnsTotal is always 0 (add-ons are
  // per-visit, tracked separately in packageAddOnsTotal), so this is purely
  // the cleaning+travel+supplies portion, identical every visit.
  const rawCalculatedTotal = Math.max(MINIMUM_SERVICE_TOTAL, preDiscountTotal - actualDiscountTotal);
  const calculatedTotal = roundToCents(rawCalculatedTotal);

  // Only the prepaid package has a fixed, known visit count the customer
  // commits to and pays for upfront, so only it gets a meaningful "total
  // for all visits" — ordinary open-ended recurring pricing does not.
  // Round once, at the very end, over the full-precision sum — never round
  // the per-visit or per-add-on components first.
  const prepaidPackageTotal = isPackage
    ? roundToCents(rawCalculatedTotal * input.visitCount + packageAddOnsTotal)
    : null;

  // Reporting convenience only — an average, not a literal per-visit price,
  // since individual visits can carry different add-ons.
  const effectivePricePerVisit =
    prepaidPackageTotal !== null ? roundToCents(prepaidPackageTotal / input.visitCount) : null;

  const recommendedService: CalculationResult["recommendedService"] =
    input.cleaningType === "standard" && input.condition === "heavy" ? "deep" : null;

  // A required configuration input is missing — this can never be presented
  // as a complete, final instant quote (owner message 2026-08-12, items 2-5).
  const hasBlockingConfigurationGap =
    !travelConfigured || !suppliesEquipmentConfigured || !squareFootageConfigured || !roomAdjustmentConfigured;

  const base = {
    pricingVersion: PRICING_VERSION,
    calculatedAt: input.asOf.toISOString(),
    propertyKind: input.propertyKind,
    cleaningType: input.cleaningType,
    condition: input.condition,
    sizeTier: input.sizeTier,
    basePrice,
    roomAdjustments,
    roomAdjustmentConfigured,
    squareFootageMultiplier,
    squareFootageConfigured,
    conditionMultiplier,
    cleaningSubtotal,
    frequency: input.frequency,
    visitCount: input.visitCount,
    discountProgram,
    recurringAdjustment,
    packageDiscount,
    travelPercentage,
    travelCharge,
    travelConfigured,
    suppliesEquipmentCharge,
    suppliesEquipmentConfigured,
    pricedAddOns,
    pricedAddOnsTotal,
    manualQuoteAddOns,
    packageAddOnsTotal,
    packagePricedAddOns,
    packageManualQuoteAddOns,
    activeFirstCleaningOfferPercent,
    firstCleaningEligible: input.firstCleaningEligible,
    firstCleaningDiscount,
    preDiscountTotal,
    calculatedTotal,
    hasStartingAtPricing,
    prepaidPackageTotal,
    effectivePricePerVisit,
    minimumServiceTotalApplied,
    recommendedService,
  };

  const hasManualQuoteAddOn =
    manualQuoteAddOns.length > 0 ||
    packageManualQuoteAddOns.length > 0 ||
    manualReviewReasons.includes("ADD_ON_VISIT_ASSIGNMENT_REQUIRED");

  if (hasBlockingConfigurationGap) {
    return {
      ...base,
      estimateType: "manual-review",
      range: null,
      manualReviewRequired: true,
      manualReviewReasons,
    };
  }

  const range = buildEstimateRange(calculatedTotal, input.condition, minimumServiceTotalApplied);

  return {
    ...base,
    estimateType: "instant-range",
    range,
    manualReviewRequired: hasManualQuoteAddOn,
    manualReviewReasons,
  };
}
