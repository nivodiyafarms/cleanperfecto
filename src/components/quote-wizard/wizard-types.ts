import type { CleaningType, Condition, FrequencyId } from "@/lib/pricing/types";
import type { InstantQuotePropertyType, LeadSource } from "@/lib/instant-quote/types";

/**
 * The wizard's own residential-only property scope — restaurant/office are
 * commercial-manual-quote paths not offered through this fast, 2-step
 * consumer flow (InstantQuotePropertyType still includes them for the
 * backend's benefit; the UI simply never lets a customer pick them here).
 */
export type WizardPropertyType = Extract<InstantQuotePropertyType, "home" | "apartment" | "airbnb">;

/**
 * Phase 1 deliberately has no customer-facing prepaid-package concept — no
 * toggle, no visit count. Every submission from this wizard is an ordinary
 * (non-prepaid) quote; see map-form-to-raw-input.ts. The 6+ prepaid package
 * offer is planned for the future Booking + Payment milestone instead. The
 * backend's package support (src/lib/pricing/, InstantQuoteRawInput's
 * isPrepaidPackage/visitCount/visitAddOns) is untouched and unaffected.
 */
export interface WizardFormState {
  // Step 1 — Your Cleaning
  propertyType: WizardPropertyType;
  cleaningType: CleaningType;
  bedrooms: number; // 0 = Studio, 5 = "5+"
  fullBathrooms: number;
  halfBathrooms: number;
  squareFeet: string; // raw text field value — parsed at submission time; "" means not provided
  condition: Condition;
  zip: string;
  frequency: FrequencyId;

  // Step 2 — Where should we send your estimate?
  firstName: string;
  phone: string;
  email: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
}

export const DEFAULT_WIZARD_FORM_STATE: WizardFormState = {
  propertyType: "home",
  cleaningType: "standard",
  bedrooms: 2,
  fullBathrooms: 1,
  halfBathrooms: 0,
  squareFeet: "",
  condition: "light",
  zip: "",
  frequency: "one_time",

  firstName: "",
  phone: "",
  email: "",
  addressLine1: "",
  addressLine2: "",
  city: "",
};

/**
 * Post-estimate optional details. No preferred-date field here by design —
 * real scheduling belongs to the upcoming Booking + Payment milestone, and
 * asking for a date before that exists would be premature UI.
 */
export interface PostEstimateDetails {
  leadSource: LeadSource | "";
  leadSourceDetail: string;
}

export const DEFAULT_POST_ESTIMATE_DETAILS: PostEstimateDetails = {
  leadSource: "",
  leadSourceDetail: "",
};
