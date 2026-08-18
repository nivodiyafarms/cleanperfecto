import type { SubmitInstantQuoteResult } from "./submit-instant-quote";

/**
 * What the future customer-facing UI is allowed to see. Deliberately does
 * NOT include: customer_id, normalized identifiers, conflicting customer
 * UUIDs, pricing_snapshot, any database column, or raw internal
 * manual_review_reasons codes (e.g. "CUSTOMER_IDENTITY_CONFLICT",
 * "ZIP_TRAVEL_NOT_CONFIGURED") — those are for the admin email only. See
 * build-email-details.ts for the separate, richer shape used internally to
 * build admin/customer emails from the same trusted server result.
 */
export type InstantQuoteRequestResult =
  | InstantQuoteRequestAutomaticEstimate
  | InstantQuoteRequestManualReview
  | InstantQuoteRequestValidationFailure
  | InstantQuoteRequestFailure;

export interface InstantQuoteRequestAutomaticEstimate {
  success: true;
  quoteId: string;
  estimateType: "instant_range";
  manualReviewRequired: false;
  displayRangeLower: number;
  displayRangeUpper: number;
  hasStartingAtPricing: boolean;
  /** Non-null only for a 6+ prepaid package. */
  prepaidPackageTotal: number | null;
  effectivePricePerVisit: number | null;
  firstCleaningOfferApplied: boolean;
}

export interface InstantQuoteRequestManualReview {
  success: true;
  quoteId: string;
  estimateType: "manual_review";
  manualReviewRequired: true;
  /**
   * A single, deliberately generic customer-safe code — never one of the
   * pricing engine's or core's internal ManualReviewReasonCode /
   * CUSTOMER_IDENTITY_CONFLICT values. Those internal codes are for the
   * admin email only (see build-admin-email.ts).
   */
  reasonCode: "custom_quote_required";
  customerMessage: string;
}

export interface InstantQuoteRequestValidationFailure {
  success: false;
  stage: "validation";
  /** Describes problems with the customer's own submitted input (e.g. "email is not a valid email address") — never an internal/server detail. */
  errors: string[];
}

export interface InstantQuoteRequestFailure {
  success: false;
  stage: "failed";
  /** Generic, customer-safe message only — never a provider/database error string. */
  message: string;
}

const MANUAL_REVIEW_CUSTOMER_MESSAGE =
  "We received your request and will contact you to confirm the details and pricing.";

/**
 * Maps the trusted core's result into the customer-safe shape above. Only
 * ever called after submitInstantQuote has already returned ok:true (a
 * persisted quote) — this function itself performs no I/O and makes no
 * trust decisions of its own, it only narrows/redacts an already-trusted
 * result.
 */
export function mapToCustomerSafeResult(
  result: Extract<SubmitInstantQuoteResult, { ok: true }>
): InstantQuoteRequestAutomaticEstimate | InstantQuoteRequestManualReview {
  if (result.estimateType === "manual_review" || result.range === null) {
    return {
      success: true,
      quoteId: result.quoteId,
      estimateType: "manual_review",
      manualReviewRequired: true,
      reasonCode: "custom_quote_required",
      customerMessage: MANUAL_REVIEW_CUSTOMER_MESSAGE,
    };
  }

  return {
    success: true,
    quoteId: result.quoteId,
    estimateType: "instant_range",
    manualReviewRequired: false,
    displayRangeLower: result.range.lower,
    displayRangeUpper: result.range.upper,
    hasStartingAtPricing: result.hasStartingAtPricing,
    prepaidPackageTotal: result.prepaidPackageTotal,
    effectivePricePerVisit: result.effectivePricePerVisit,
    firstCleaningOfferApplied: result.firstCleaningOfferApplied,
  };
}
