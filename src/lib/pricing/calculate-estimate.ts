import { getActiveFirstCleaningOffer } from "@/lib/offers/first-cleaning-offer";
import { classifyAddOns } from "./add-ons";
import {
  BASE_PRICES,
  CONDITION_MULTIPLIERS,
  MINIMUM_SERVICE_TOTAL,
  MOVE_BASE_PRICE,
  PRICING_VERSION,
  RANGE_MULTIPLIERS,
  RANGE_ROUNDING_INCREMENT,
} from "./config";
import { chooseCleaningServiceDiscount } from "./discount-program";
import { getRoomAdjustment, ROOM_ADJUSTMENT_CONFIG, type RoomAdjustmentConfig } from "./room-adjustments";
import { getSquareFootageMultiplier, SQUARE_FOOTAGE_CONFIG, type SquareFootageBand } from "./square-footage";
import {
  getSuppliesEquipmentCharge,
  SUPPLIES_EQUIPMENT_CONFIG,
  type SuppliesEquipmentRule,
} from "./supplies-equipment";
import type { CalculationInput, CalculationResult, ManualReviewReasonCode } from "./types";
import { getZipTravelRule, ZIP_TRAVEL_CONFIG, type ZipTravelRule } from "./zip-travel";

/** Injectable config bundle — defaults to (currently unconfigured) production config; tests override with isolated fixtures. */
export interface PricingConfigOverrides {
  zipTravelConfig?: ZipTravelRule[];
  suppliesEquipmentConfig?: SuppliesEquipmentRule[];
  squareFootageConfig?: SquareFootageBand[];
  roomAdjustmentConfig?: RoomAdjustmentConfig;
}

function roundUpToIncrement(value: number, increment: number): number {
  return Math.ceil(value / increment) * increment;
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
    activeFirstCleaningOfferPercent: null,
    firstCleaningEligible: input.firstCleaningEligible,
    firstCleaningDiscount: 0,
    preDiscountTotal: 0,
    calculatedTotal: 0,
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
  const roomAdjustmentResult = getRoomAdjustment(input.sizeTier, input.rooms, roomAdjustmentConfig);
  const roomAdjustmentConfigured = roomAdjustmentResult.configured;
  const roomAdjustments = roomAdjustmentResult.configured ? roomAdjustmentResult.amount : 0;
  if (!roomAdjustmentResult.configured) {
    manualReviewReasons.push(roomAdjustmentResult.reason);
  }

  let squareFootageMultiplier = 1;
  let squareFootageConfigured = true;
  if (input.squareFeet !== undefined) {
    const squareFootageConfig = overrides.squareFootageConfig ?? SQUARE_FOOTAGE_CONFIG;
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

  const suppliesEquipmentConfig = overrides.suppliesEquipmentConfig ?? SUPPLIES_EQUIPMENT_CONFIG;
  const suppliesResult = getSuppliesEquipmentCharge(
    input.cleaningType,
    input.sizeTier,
    suppliesEquipmentConfig
  );
  const suppliesEquipmentConfigured = suppliesResult.configured;
  const suppliesEquipmentCharge = suppliesResult.configured ? suppliesResult.amount : 0;
  if (!suppliesResult.configured) {
    manualReviewReasons.push(suppliesResult.reason);
  }

  const { priced: pricedAddOns, pricedTotal: pricedAddOnsTotal, manual: manualQuoteAddOns } = classifyAddOns(
    input.addOnIds
  );
  if (manualQuoteAddOns.length > 0) {
    manualReviewReasons.push("MANUAL_QUOTE_ADD_ON_SELECTED");
  }

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

  const calculatedTotal = Math.max(MINIMUM_SERVICE_TOTAL, preDiscountTotal - actualDiscountTotal);

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
    activeFirstCleaningOfferPercent,
    firstCleaningEligible: input.firstCleaningEligible,
    firstCleaningDiscount,
    preDiscountTotal,
    calculatedTotal,
    minimumServiceTotalApplied,
    recommendedService,
  };

  if (hasBlockingConfigurationGap) {
    return {
      ...base,
      estimateType: "manual-review",
      range: null,
      manualReviewRequired: true,
      manualReviewReasons,
    };
  }

  const rangeMultiplier = RANGE_MULTIPLIERS[input.condition];
  const lower = minimumServiceTotalApplied
    ? MINIMUM_SERVICE_TOTAL
    : Math.max(MINIMUM_SERVICE_TOTAL, roundUpToIncrement(calculatedTotal, RANGE_ROUNDING_INCREMENT));
  const upper = Math.max(
    lower,
    roundUpToIncrement(calculatedTotal * rangeMultiplier, RANGE_ROUNDING_INCREMENT)
  );

  return {
    ...base,
    estimateType: "instant-range",
    range: { lower, upper },
    manualReviewRequired: manualQuoteAddOns.length > 0,
    manualReviewReasons,
  };
}
