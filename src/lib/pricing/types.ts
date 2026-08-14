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
  | "ZIP_MANUAL_REVIEW_REQUIRED"
  | "SUPPLIES_EQUIPMENT_NOT_CONFIGURED"
  | "SQUARE_FOOTAGE_NOT_CONFIGURED"
  | "SQUARE_FOOTAGE_BEYOND_CONFIGURED_LIMIT"
  | "ROOM_ADJUSTMENT_NOT_CONFIGURED"
  | "MANUAL_QUOTE_ADD_ON_SELECTED"
  | "ADD_ON_VISIT_ASSIGNMENT_REQUIRED";

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
  /**
   * Add-ons for a single, one-off cleaning (one-time or plain recurring —
   * NOT a 6+ prepaid package). Ignored when the request resolves to the
   * prepaid_package discount program; see `visitAddOns` below for that case
   * — add-ons belong to individual visits, never "once per package".
   */
  addOnIds: AddOnId[];
  /**
   * Per-visit add-on assignments for a 6+ prepaid package, owner-approved
   * 2026-08-13: `visitAddOns[i]` is the list of add-ons selected for visit
   * `i + 1`; a missing/undefined entry or a visit past the array's end
   * means no add-ons for that visit. Only consulted when the request
   * resolves to the prepaid_package discount program. The engine never
   * infers which visit an add-on belongs to — if this is omitted (or
   * empty) but `addOnIds` is non-empty on a package request, the add-ons
   * are flagged for manual review rather than guessed at.
   */
  visitAddOns?: AddOnId[][];
  /** Resolved server-side by a future eligibility service — never a client-submitted boolean taken at face value. */
  firstCleaningEligible: boolean;
  /** Instant the calculation is evaluated as of, passed explicitly so the pure engine stays deterministic (same pattern as getActiveFirstCleaningOffer). */
  asOf: Date;
}

export interface PricedAddOnResult {
  id: AddOnId;
  label: string;
  amount: number;
  /** "fixed" is an exact, guaranteed charge; "starting_at" is a floor, not a promise — see CalculationResult.hasStartingAtPricing. */
  pricingKind: "fixed" | "starting_at";
  /** 1-based visit number this selection belongs to. Present only for prepaid-package `visitAddOns` entries; absent for the classic single-request `addOnIds` usage. */
  visitNumber?: number;
}

export interface ManualQuoteAddOnResult {
  id: AddOnId;
  label: string;
  /** 1-based visit number this selection belongs to. Present only for prepaid-package `visitAddOns` entries; absent for the classic single-request `addOnIds` usage. */
  visitNumber?: number;
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
  visitCount: number;
  discountProgram: DiscountProgram;
  recurringAdjustment: number;
  packageDiscount: number;

  travelPercentage: number | null;
  travelCharge: number;
  travelConfigured: boolean;

  suppliesEquipmentCharge: number;
  suppliesEquipmentConfigured: boolean;

  /** Reflects `addOnIds`. Always empty/0 when discountProgram === "prepaid_package" — see packageAddOnsTotal/packageManualQuoteAddOns below instead. */
  pricedAddOns: PricedAddOnResult[];
  pricedAddOnsTotal: number;
  manualQuoteAddOns: ManualQuoteAddOnResult[];

  /** Sum of priced add-ons across every visit's `visitAddOns` assignment. 0 unless discountProgram === "prepaid_package". Never discounted, never divided evenly across visits. */
  packageAddOnsTotal: number;
  /** Every priced add-on selected across `visitAddOns`, each tagged with its 1-based visitNumber — preserves pricingKind (fixed vs starting_at) per selection, never collapsed to a bare number. Empty unless discountProgram === "prepaid_package". */
  packagePricedAddOns: PricedAddOnResult[];
  /** Manual-quote add-ons selected across `visitAddOns`, each tagged with its 1-based visitNumber. Empty unless discountProgram === "prepaid_package". */
  packageManualQuoteAddOns: ManualQuoteAddOnResult[];

  activeFirstCleaningOfferPercent: number | null;
  firstCleaningEligible: boolean;
  firstCleaningDiscount: number;

  preDiscountTotal: number;
  calculatedTotal: number;

  /**
   * True whenever any add-on contributing to preDiscountTotal/calculatedTotal
   * (or, for a prepaid package, packageAddOnsTotal/prepaidPackageTotal/
   * effectivePricePerVisit) is "starting_at" rather than "fixed". A
   * starting-at amount is the approved MINIMUM, not a guaranteed final
   * price (e.g. Inside Cabinets & Drawers "starting at $40", Extra Pet Hair
   * Removal "starting at $20") — a caller (future UI/payment code) MUST
   * check this flag before presenting or charging those totals as an exact,
   * guaranteed payable amount. When true, present the total as an estimate
   * ("starting at $X" / "requires confirmation"), never as a final price.
   */
  hasStartingAtPricing: boolean;

  /**
   * Authoritative, payable total for the entire prepaid package, rounded to
   * the cent: (per-visit discounted cleaning + undiscounted travel +
   * undiscounted supplies) × visitCount, plus packageAddOnsTotal (each
   * visit's own selected add-ons, summed — never inferred, never divided
   * evenly, never discounted). Null unless discountProgram ===
   * "prepaid_package", since only that program has a fixed, known, prepaid
   * visit count with a meaningful "total" — ordinary open-ended recurring
   * pricing does not.
   */
  prepaidPackageTotal: number | null;

  /**
   * Reporting convenience: prepaidPackageTotal ÷ visitCount, rounded to the
   * cent. An AVERAGE, not a literal per-visit price — individual visits can
   * differ once they carry different add-ons. Null unless discountProgram
   * === "prepaid_package".
   */
  effectivePricePerVisit: number | null;

  minimumServiceTotalApplied: boolean;

  range: EstimateRange | null;

  recommendedService: CleaningType | null;

  manualReviewRequired: boolean;
  manualReviewReasons: ManualReviewReasonCode[];
}
