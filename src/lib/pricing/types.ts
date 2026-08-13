import type { FrequencyId } from "@/lib/quote/frequency";

// Pure types for the CleanPerfecto instant pricing engine. No React, no
// Supabase, no network — see calculate-estimate.ts for the pure orchestrator
// that consumes these.

/**
 * Intentionally its own enum, independent of the production PropertyTypeId
 * in src/lib/property-types.ts. "apartment" is not yet an approved
 * production property type (CLAUDE.md's Property Selector only has
 * Home/Airbnb/Restaurant/Office) — keeping this enum separate lets the
 * pricing engine model Apartment using Home's residential formulas now
 * without touching the production schema, hero selector, or database enum
 * until that's separately approved and migrated.
 */
export type PropertyKind = "home" | "apartment" | "airbnb" | "commercial";

export type CleaningType = "standard" | "deep" | "move";

export type Condition = "light" | "moderate" | "heavy" | "extensive";

export type SizeTier =
  | "studio_1ba"
  | "1br_1ba"
  | "2br_2ba"
  | "3br_2ba"
  | "4br_plus";

export type { FrequencyId };

export type EstimateType = "instant-range" | "manual-review";

export type DiscountProgram =
  | "none"
  | "first_cleaning"
  | "recurring_cycle"
  | "prepaid_package";

export type ManualReviewReasonCode =
  | "COMMERCIAL_PROPERTY"
  | "CONDITION_NOT_AVAILABLE_FOR_SERVICE"
  | "ZIP_TRAVEL_NOT_CONFIGURED"
  | "SUPPLIES_EQUIPMENT_NOT_CONFIGURED"
  | "SQUARE_FOOTAGE_NOT_CONFIGURED"
  | "SQUARE_FOOTAGE_BEYOND_CONFIGURED_LIMIT"
  | "ROOM_ADJUSTMENT_NOT_CONFIGURED"
  | "MANUAL_QUOTE_ADD_ON_SELECTED";

export type AddOnId =
  | "inside_oven"
  | "inside_refrigerator"
  | "inside_cabinets_drawers"
  | "extra_pet_hair_removal"
  | "carpet_shampooing"
  | "heavy_organization"
  | "additional_interior_window_detailing"
  | "boxing_packing";

export interface RoomCounts {
  bedrooms: number;
  fullBathrooms: number;
  halfBathrooms: number;
}

export interface CalculationInput {
  propertyKind: PropertyKind;
  cleaningType: CleaningType;
  condition: Condition;
  sizeTier: SizeTier;
  /** Actual bedroom/bathroom counts, only needed once they exceed the size tier's baseline (see config.ts SIZE_TIER_BASELINE_ROOMS). */
  rooms?: RoomCounts;
  /** Approximate square footage. Omit entirely when the customer hasn't provided it — the multiplier then stays neutral (1.00) with no manual-review flag. */
  squareFeet?: number;
  zip: string;
  frequency: FrequencyId;
  isPrepaidPackage: boolean;
  visitCount: number;
  addOnIds: AddOnId[];
  /** Resolved server-side by a future eligibility service — never a client-submitted boolean taken at face value. */
  firstCleaningEligible: boolean;
  /** Instant the calculation is evaluated as of, passed explicitly so the pure engine stays deterministic (same pattern as getActiveFirstCleaningOffer). */
  asOf: Date;
}

export interface PricedAddOnResult {
  id: AddOnId;
  label: string;
  amount: number;
  pricingKind: "fixed" | "starting_at";
}

export interface ManualQuoteAddOnResult {
  id: AddOnId;
  label: string;
}

export interface EstimateRange {
  lower: number;
  upper: number;
}

export interface CalculationResult {
  estimateType: EstimateType;
  pricingVersion: string;
  calculatedAt: string;

  propertyKind: PropertyKind;
  cleaningType: CleaningType;
  condition: Condition;
  sizeTier: SizeTier;

  basePrice: number;

  roomAdjustments: number;
  roomAdjustmentConfigured: boolean;

  squareFootageMultiplier: number;
  squareFootageConfigured: boolean;

  conditionMultiplier: number;

  cleaningSubtotal: number;

  frequency: FrequencyId;
  discountProgram: DiscountProgram;
  recurringAdjustment: number;
  packageDiscount: number;

  travelPercentage: number | null;
  travelCharge: number;
  travelConfigured: boolean;

  suppliesEquipmentCharge: number;
  suppliesEquipmentConfigured: boolean;

  pricedAddOns: PricedAddOnResult[];
  pricedAddOnsTotal: number;
  manualQuoteAddOns: ManualQuoteAddOnResult[];

  activeFirstCleaningOfferPercent: number | null;
  firstCleaningEligible: boolean;
  firstCleaningDiscount: number;

  preDiscountTotal: number;
  calculatedTotal: number;

  minimumServiceTotalApplied: boolean;

  range: EstimateRange | null;

  recommendedService: CleaningType | null;

  manualReviewRequired: boolean;
  manualReviewReasons: ManualReviewReasonCode[];
}
