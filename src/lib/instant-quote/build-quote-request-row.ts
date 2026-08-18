import type { ServiceId } from "@/lib/services";
import type { CalculationInput, CalculationResult } from "@/lib/pricing/types";
import { mapEstimateTypeToDb } from "./pricing-snapshot";
import type { EntryChannel, InstantQuoteManualReviewReasonCode, ValidatedInstantQuoteInput } from "./types";

export interface BuildQuoteRequestRowParams {
  id: string;
  customerId: string | null;
  entryChannel: EntryChannel;
  validated: ValidatedInstantQuoteInput;
  emailNormalized: string | null;
  phoneNormalized: string | null;
  serviceAddressIdentity: string | null;
  legacyServiceId: ServiceId;
  calculationInput: CalculationInput;
  calculationResult: CalculationResult;
  /** Reasons that exist outside the pricing engine's own manualReviewReasons — currently only a customer identity conflict. */
  additionalManualReviewReasons?: InstantQuoteManualReviewReasonCode[];
  /**
   * When true, persists estimate_type as "manual_review" regardless of what
   * the pricing engine itself computed — used for a customer identity
   * conflict, where the request must never look like an ordinary automatic
   * instant quote even if the underlying pricing calculation succeeded
   * cleanly. The engine's real calculated_total/range are still persisted
   * as informational context for whoever resolves the conflict; only the
   * estimate_type flag is overridden.
   */
  forceManualReview?: boolean;
}

/**
 * Maps everything gathered by submit-instant-quote.ts into the exact
 * quote_requests row shape (snake_case columns matching the approved
 * migration). Does not include `created_at` — like the legacy QuoteForm's
 * submitQuoteRequest.ts, that column is left to its DB default so the
 * database clock is always the source of truth. Does not include `status`
 * — its DB default ('new') is correct for every quote created through this
 * flow.
 */
export function buildQuoteRequestRow(params: BuildQuoteRequestRowParams) {
  const { validated, calculationInput, calculationResult: result } = params;

  const manualReviewReasons: InstantQuoteManualReviewReasonCode[] = [
    ...result.manualReviewReasons,
    ...(params.additionalManualReviewReasons ?? []),
  ];

  return {
    id: params.id,

    name: validated.name,
    phone: validated.phone,
    email: validated.email,
    zip: validated.serviceAddress.zip,
    property_type: validated.propertyType,
    service_id: params.legacyServiceId,
    preferred_date: validated.preferredDate,
    message: validated.message,

    customer_id: params.customerId,

    entry_channel: params.entryChannel,
    lead_source: validated.leadSource,
    lead_source_detail: validated.leadSourceDetail,

    cleaning_type: calculationInput.cleaningType,
    frequency: calculationInput.frequency,
    is_prepaid_package: calculationInput.isPrepaidPackage,
    visit_count: calculationInput.visitCount,

    bedrooms: validated.rooms.bedrooms,
    full_bathrooms: validated.rooms.fullBathrooms,
    half_bathrooms: validated.rooms.halfBathrooms,
    square_feet: validated.squareFeet,
    condition: calculationInput.condition,

    service_address_line1: validated.serviceAddress.line1,
    service_address_line2: validated.serviceAddress.line2,
    service_city: validated.serviceAddress.city,
    service_state: validated.serviceAddress.state,
    service_address_identity: params.serviceAddressIdentity,

    email_normalized: params.emailNormalized,
    phone_normalized: params.phoneNormalized,

    estimate_type: params.forceManualReview ? "manual_review" : mapEstimateTypeToDb(result.estimateType),
    pricing_version: result.pricingVersion,

    calculated_total: result.calculatedTotal,
    display_range_lower: result.range?.lower ?? null,
    display_range_upper: result.range?.upper ?? null,

    prepaid_package_total: result.prepaidPackageTotal,
    effective_price_per_visit: result.effectivePricePerVisit,

    has_starting_at_pricing: result.hasStartingAtPricing,

    manual_review_reasons: manualReviewReasons,

    first_cleaning_offer_applied: result.discountProgram === "first_cleaning",

    pricing_snapshot: { input: calculationInput, result },
  };
}

export type QuoteRequestRow = ReturnType<typeof buildQuoteRequestRow>;
