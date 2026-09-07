/**
 * The customer-safe pricing display shape shared by both the persisting
 * initial-estimate result (instant-quote-request-result.ts) and the
 * non-persisting post-estimate customization preview
 * (preview-instant-quote-customization-result.ts) — same fields, same
 * redaction rules, used in two different wrapping contexts (one has a
 * quoteId because it persisted a row; the preview doesn't, because it
 * persists nothing).
 */
import type { MovePackageLevel } from "@/lib/pricing/types";

export interface InstantQuoteEstimateDisplay {
  estimateType: "instant_range";
  /**
   * True when a manual-quote add-on (e.g. Carpet Shampooing) was selected
   * alongside an otherwise-priceable request — the base range above is
   * still valid and shown, but that specific add-on needs manual
   * confirmation. This is the ONLY way manualReviewRequired can be true
   * while estimateType stays "instant_range" (see calculate-estimate.ts's
   * hasManualQuoteAddOn branch) — any other manual-review condition
   * (unconfigured ZIP/sqft/etc.) forces estimateType to "manual_review"
   * instead, which the caller handles as InstantQuoteManualReviewDisplay.
   */
  manualReviewRequired: boolean;
  displayRangeLower: number;
  displayRangeUpper: number;
  hasStartingAtPricing: boolean;
  /** Non-null only for a 6+ prepaid package. */
  prepaidPackageTotal: number | null;
  effectivePricePerVisit: number | null;
  firstCleaningOfferApplied: boolean;
  /**
   * Non-null only when firstCleaningOfferApplied is true — the same
   * trusted engine's answer to "what would this cost without the
   * first-cleaning special" (see estimate-with-comparison.ts). Never
   * present/non-null when the offer wasn't actually applied — the UI must
   * never fabricate a struck-through comparison price.
   */
  regularDisplayRangeLower: number | null;
  regularDisplayRangeUpper: number | null;
  /**
   * True when the $99 minimum-service floor actually capped the applied
   * discount for this estimate (see MINIMUM_SERVICE_TOTAL enforcement in
   * calculate-estimate.ts). The UI should only show the "$99 minimum
   * service total applies" note near a result when this is true — not
   * unconditionally whenever a discount was applied.
   */
  minimumServiceFloorApplied: boolean;

  /** Null unless the request's cleaningType is "move" (Move-In/Move-Out). */
  movePackageLevel: MovePackageLevel | null;
  /**
   * False only when Complete was requested but the property's square
   * footage is beyond the configured Complete-upgrade bands — the UI must
   * show "Custom Quote" for Complete rather than the number above (which,
   * in that specific case, is actually Basic's price — see
   * calculate-estimate.ts). Null unless movePackageLevel is non-null.
   */
  moveCompleteUpgradeConfigured: boolean | null;
}

export interface InstantQuoteManualReviewDisplay {
  estimateType: "manual_review";
  manualReviewRequired: true;
  /**
   * A single, deliberately generic customer-safe code — never one of the
   * pricing engine's or core's internal ManualReviewReasonCode /
   * CUSTOMER_IDENTITY_CONFLICT values. Those internal codes are for the
   * admin email only.
   */
  reasonCode: "custom_quote_required";
  customerMessage: string;
}

export const MANUAL_REVIEW_CUSTOMER_MESSAGE =
  "We received your request and will contact you to confirm the details and pricing.";
