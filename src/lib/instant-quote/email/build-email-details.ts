import type { SubmitInstantQuoteResult } from "../submit-instant-quote";
import type { InstantQuoteManualReviewReasonCode, InstantQuoteRawInput } from "../types";

/**
 * The richer, server-internal shape used to build BOTH the admin and
 * customer emails from the same trusted values — never the customer-safe
 * InstantQuoteRequestResult (see instant-quote-request-result.ts), and
 * never returned to the browser. Built from:
 *   - rawInput: the exact object already passed into submitInstantQuote,
 *     safe to read here only because result.ok === true already proves it
 *     passed server-side validation — nothing here is re-trusted or
 *     re-validated, it's the same trusted call, just read for display.
 *   - result: submitInstantQuote's own authoritative ok:true result.
 * Never built from a customer-submitted price/discount/eligibility value.
 */
export interface InstantQuoteEmailDetails {
  quoteId: string;

  name: string;
  phone: string | null;
  email: string | null;

  propertyType: InstantQuoteRawInput["propertyType"];
  cleaningType: InstantQuoteRawInput["cleaningType"];
  condition: InstantQuoteRawInput["condition"];
  rooms: InstantQuoteRawInput["rooms"];
  squareFeet: number | null;

  serviceAddress: InstantQuoteRawInput["serviceAddress"];

  frequency: InstantQuoteRawInput["frequency"];
  isPrepaidPackage: boolean;
  visitCount: number;
  addOnIds: InstantQuoteRawInput["addOnIds"];
  visitAddOns: InstantQuoteRawInput["visitAddOns"] | null;

  preferredDate: string | null;
  message: string | null;
  leadSource: InstantQuoteRawInput["leadSource"] | null;
  leadSourceDetail: string | null;

  estimateType: "instant_range" | "manual_review";
  calculatedTotal: number;
  range: { lower: number; upper: number } | null;
  hasStartingAtPricing: boolean;
  prepaidPackageTotal: number | null;
  effectivePricePerVisit: number | null;
  firstCleaningOfferApplied: boolean;
  identityConflict: boolean;
  manualReviewRequired: boolean;
  manualReviewReasons: InstantQuoteManualReviewReasonCode[];
}

export function buildInstantQuoteEmailDetails(
  rawInput: InstantQuoteRawInput,
  result: Extract<SubmitInstantQuoteResult, { ok: true }>
): InstantQuoteEmailDetails {
  return {
    quoteId: result.quoteId,

    name: rawInput.name.trim(),
    phone: rawInput.phone?.trim() || null,
    email: rawInput.email?.trim() || null,

    propertyType: rawInput.propertyType,
    cleaningType: rawInput.cleaningType,
    condition: rawInput.condition,
    rooms: rawInput.rooms,
    squareFeet: rawInput.squareFeet ?? null,

    serviceAddress: rawInput.serviceAddress,

    frequency: rawInput.frequency,
    isPrepaidPackage: rawInput.isPrepaidPackage,
    visitCount: rawInput.visitCount,
    addOnIds: rawInput.addOnIds,
    visitAddOns: rawInput.visitAddOns ?? null,

    preferredDate: rawInput.preferredDate?.trim() || null,
    message: rawInput.message?.trim() || null,
    leadSource: rawInput.leadSource ?? null,
    leadSourceDetail: rawInput.leadSourceDetail?.trim() || null,

    estimateType: result.estimateType,
    calculatedTotal: result.calculatedTotal,
    range: result.range,
    hasStartingAtPricing: result.hasStartingAtPricing,
    prepaidPackageTotal: result.prepaidPackageTotal,
    effectivePricePerVisit: result.effectivePricePerVisit,
    firstCleaningOfferApplied: result.firstCleaningOfferApplied,
    identityConflict: result.identityConflict,
    manualReviewRequired: result.manualReviewRequired,
    manualReviewReasons: result.manualReviewReasons,
  };
}
