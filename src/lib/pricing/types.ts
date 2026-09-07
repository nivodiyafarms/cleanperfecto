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

/** Optional dedicated rooms, priced through the same generic room-adjustment mechanism as bedrooms/bathrooms — see room-adjustments.ts's getSpecialRoomCharges. */
export type SpecialRoomId = "game_room" | "media_room";

/**
 * Move-In/Move-Out package tier (owner-approved hotfix, 2026-08-30). Only
 * meaningful when cleaningType === "move" — ignored otherwise. Defaults to
 * "basic" when omitted on a move request. Complete = Basic + a square-
 * footage-banded upgrade (see move-package.ts) and folds Refrigerator/Oven/
 * Cabinet Interior into the package instead of charging them standalone.
 */
export type MovePackageLevel = "basic" | "complete";

/** Cosmetic pass-through only — pricing is identical for both directions. Carried so persistence/UI can label "Move-In" vs "Move-Out" without inventing a second CleaningType. */
export type MoveDirection = "move_in" | "move_out";

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
  | "ADD_ON_VISIT_ASSIGNMENT_REQUIRED"
  | "MOVE_COMPLETE_UPGRADE_NOT_CONFIGURED"
  | "PORCH_BEYOND_CONFIGURED_LIMIT"
  | "PATIO_BEYOND_CONFIGURED_LIMIT"
  | "GARAGE_BEYOND_CONFIGURED_LIMIT"
  | "TRIO_CAPACITY_EXCEEDED"
  | "OIL_DEGREASE_BAYS_EXCEED_GARAGE_CAPACITY";

export type AddOnId =
  | "inside_oven"
  | "inside_refrigerator"
  | "refrigerator_oven_bundle"
  | "inside_cabinets_drawers"
  | "extra_pet_hair_removal"
  | "carpet_shampooing"
  | "heavy_organization"
  | "additional_interior_window_detailing"
  | "boxing_packing";

/** Priced per unit (e.g. per pane) rather than as a flat presence/absence charge — see add-ons.ts's QUANTIFIED_ADD_ON_CATALOG. */
export type QuantifiedAddOnId = "interior_window_detailing" | "exterior_window_cleaning";

export interface QuantifiedAddOnSelection {
  id: QuantifiedAddOnId;
  /** Count of units (e.g. windows). Must be a positive integer. */
  quantity: number;
}

export interface SpecialRoomChargeResult {
  id: SpecialRoomId;
  label: string;
  amount: number;
}

export interface QuantifiedAddOnResult {
  id: QuantifiedAddOnId;
  label: string;
  quantity: number;
  amount: number;
}

export interface OutdoorChargeResult {
  id: string;
  label: string;
  amount: number;
}

export interface OutdoorManualChargeResult {
  id: string;
  label: string;
}

export interface RoomCounts {
  bedrooms: number;
  fullBathrooms: number;
  halfBathrooms: number;
}

export type PorchSize = "small" | "medium" | "large";
export type PatioSize = "small" | "medium" | "large";
export type TrioSize = "small" | "medium" | "large";
export type AlgaeMildewTreatmentSize = "small" | "medium" | "large";

/**
 * Outdoor add-ons — an entirely separate pricing category from indoor
 * add-ons/room adjustments (owner-approved hotfix, 2026-08-30). A Trio is an
 * EXPLICIT customer selection, never auto-bundled from individually chosen
 * dimensions (see outdoor-add-ons.ts). When `trio` is set, `porchSqFt`/
 * `patioSqFt`/`garageCars` (if also provided) are used only to validate they
 * fit the selected Trio's capacity — they never add a second, separate
 * charge on top of the Trio's flat price.
 */
export interface OutdoorSelection {
  porchSqFt?: number;
  patioSqFt?: number;
  /** 1, 2, or 3 cars are priced; more than 3 requires manual/custom pricing. */
  garageCars?: number;
  trio?: TrioSize;
  /** Number of garage bays affected by heavy oil/grease buildup — must not exceed the known garage capacity (garageCars, or the Trio's included garage size). */
  oilDegreaseAffectedBays?: number;
  algaeMildewTreatmentSize?: AlgaeMildewTreatmentSize;
}

export interface CalculationInput {
  propertyKind: PropertyKind;
  cleaningType: CleaningType;
  condition: Condition;
  sizeTier: SizeTier;
  /** Actual bedroom/bathroom counts, only needed once they exceed the size tier's baseline (see config.ts SIZE_TIER_BASELINE_ROOMS). */
  rooms?: RoomCounts;
  /** Optional dedicated Game Room / Media-Theater Room selections — priced through room-adjustments.ts's getSpecialRoomCharges, folded into roomAdjustments. */
  specialRooms?: SpecialRoomId[];
  /** Approximate square footage. Omit entirely when the customer hasn't provided it — the multiplier then stays neutral (1.00) with no manual-review flag. */
  squareFeet?: number;
  zip: string;
  frequency: FrequencyId;
  isPrepaidPackage: boolean;
  visitCount: number;
  /** Only meaningful when cleaningType === "move"; defaults to "basic" when omitted. See MovePackageLevel. */
  movePackageLevel?: MovePackageLevel;
  /** Cosmetic pass-through only — see MoveDirection. */
  moveDirection?: MoveDirection;
  /** Porch/Patio/Garage/Trio + condition-treatment selections. See OutdoorSelection. */
  outdoorSelection?: OutdoorSelection;
  /** Per-unit priced add-ons (e.g. windows). Not per-visit-assignable for a prepaid package — same one-off-only scope as addOnIds. */
  quantifiedAddOns?: QuantifiedAddOnSelection[];
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

  /** Game Room / Media-Theater Room charges — already folded into roomAdjustments above (same generic pre-multiplier mechanism); broken out here only so a customer breakdown can label them separately. */
  specialRoomCharges: SpecialRoomChargeResult[];
  specialRoomChargesTotal: number;
  specialRoomsConfigured: boolean;

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

  /** Per-unit priced add-ons (e.g. windows). Reflects `quantifiedAddOns`; not package-visit-assignable. */
  quantifiedAddOns: QuantifiedAddOnResult[];
  quantifiedAddOnsTotal: number;

  /** Null unless cleaningType === "move". Echoes the resolved package level (defaults to "basic"). */
  movePackageLevel: MovePackageLevel | null;
  /** Cosmetic pass-through of the input field — null unless cleaningType === "move" and it was supplied. */
  moveDirection: MoveDirection | null;
  /**
   * The equivalent Deep Cleaning total for this exact request (same
   * property/rooms/special rooms/sqft/condition/zip/travel/frequency/
   * eligibility — no add-ons), used to enforce "Basic Move-In/Out >=
   * equivalent Deep". Null unless cleaningType === "move".
   */
  moveEquivalentDeepTotal: number | null;
  /** True when the equivalent-Deep floor (not the $99 minimum) is what raised Basic Move's total above its own raw calculation. Null unless cleaningType === "move". */
  moveFloorApplied: boolean | null;
  /** The square-footage-banded Complete package upgrade actually applied (0 for Basic). Null unless cleaningType === "move". */
  moveCompleteUpgrade: number | null;
  /** False when Complete was requested but square footage is beyond the configured upgrade bands (manual/custom quote) — see MOVE_COMPLETE_UPGRADE_NOT_CONFIGURED. Null unless cleaningType === "move". */
  moveCompleteUpgradeConfigured: boolean | null;
  /** Refrigerator/Oven/Cabinet-Interior add-ons folded into a Complete package instead of charged standalone — never double-charged even if submitted in addOnIds. Empty unless movePackageLevel === "complete". */
  includedByCompletePackage: ManualQuoteAddOnResult[];
  /**
   * True when a Basic Move-In/Out request selected all three standalone
   * interior add-ons (Refrigerator, Oven or the bundle, Cabinets) for a
   * combined price exceeding the Complete package upgrade — informational
   * only, never auto-switches movePackageLevel or pricing.
   */
  completePackageRecommended: boolean;

  /** Porch/Patio/Garage/Trio/condition-treatment charges. Reflects `outdoorSelection`. */
  outdoorCharges: OutdoorChargeResult[];
  outdoorChargesTotal: number;
  /** Outdoor components that exceed configured limits/capacity and require a custom quote — excluded from outdoorChargesTotal, never guessed at. */
  outdoorManualCharges: OutdoorManualChargeResult[];

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
