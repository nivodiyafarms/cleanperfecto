import type { AddOnId, CleaningType, Condition, FrequencyId, ManualReviewReasonCode } from "@/lib/pricing/types";

/**
 * The pricing engine's own ManualReviewReasonCode, plus reasons that
 * originate outside pricing entirely. quote_requests.manual_review_reasons
 * is a plain text[] column (no DB enum), so combining both here is safe.
 */
export type InstantQuoteManualReviewReasonCode = ManualReviewReasonCode | "CUSTOMER_IDENTITY_CONFLICT";

// Server-authoritative — never derived from a public client payload. The
// future website entry point supplies "website" as a trusted argument
// alongside the raw input, never read off the payload itself (see
// submit-instant-quote.ts). "phone"/"text"/"admin" are reserved for future
// internal/admin-created flows.
export type EntryChannel = "website" | "phone" | "text" | "admin";

export type LeadSource =
  | "google"
  | "facebook_instagram"
  | "referral"
  | "apartment_flyer_business_card"
  | "returning_customer"
  | "other";

/**
 * The real DB quote_requests.property_type values this milestone accepts.
 * "restaurant"/"office" are modeled here only because calculateEstimate
 * already routes PropertyKind "commercial" straight to manual review with
 * zero new pricing math — no commercial automatic pricing is introduced.
 */
export type InstantQuotePropertyType = "home" | "apartment" | "airbnb" | "restaurant" | "office";

export interface RawRoomCounts {
  bedrooms: number;
  fullBathrooms: number;
  halfBathrooms: number;
}

export interface RawServiceAddress {
  line1: string;
  line2?: string;
  city?: string;
  state?: string;
  /** Also serves as the pricing engine's ZIP and the legacy NOT NULL quote_requests.zip column — one field, never duplicated. */
  zip: string;
}

/**
 * Shape a future website instant-quote submission provides. Nothing here is
 * trusted as authoritative pricing/eligibility/identity — see
 * validate-input.ts and submit-instant-quote.ts, which recompute everything
 * server-side.
 */
export interface InstantQuoteRawInput {
  propertyType: InstantQuotePropertyType;
  cleaningType: CleaningType;
  condition: Condition;
  rooms: RawRoomCounts;
  squareFeet?: number;
  frequency: FrequencyId;
  isPrepaidPackage: boolean;
  visitCount: number;
  addOnIds: AddOnId[];
  visitAddOns?: AddOnId[][];

  name: string;
  /** Raw as typed by the customer. At least one of phone/email is required. */
  phone?: string;
  email?: string;

  serviceAddress: RawServiceAddress;

  preferredDate?: string;
  message?: string;

  leadSource?: LeadSource;
  leadSourceDetail?: string;
}

export interface ValidatedServiceAddress {
  line1: string | null;
  line2: string | null;
  city: string | null;
  state: string | null;
  zip: string;
}

/** Same shape as InstantQuoteRawInput, but every field has passed format validation and blanks are normalized to null. */
export interface ValidatedInstantQuoteInput {
  propertyType: InstantQuotePropertyType;
  cleaningType: CleaningType;
  condition: Condition;
  rooms: RawRoomCounts;
  squareFeet: number | null;
  frequency: FrequencyId;
  isPrepaidPackage: boolean;
  visitCount: number;
  addOnIds: AddOnId[];
  visitAddOns: AddOnId[][] | null;

  name: string;
  phone: string | null;
  email: string | null;

  serviceAddress: ValidatedServiceAddress;

  preferredDate: string | null;
  message: string | null;

  leadSource: LeadSource | null;
  leadSourceDetail: string | null;
}
