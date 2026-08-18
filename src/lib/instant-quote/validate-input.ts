import { ADD_ON_CATALOG } from "@/lib/pricing/add-ons";
import type { AddOnId } from "@/lib/pricing/types";
import { normalizePhone } from "./normalize-phone";
import type { InstantQuoteRawInput, LeadSource, ValidatedInstantQuoteInput } from "./types";

// Deliberately small, local re-implementations rather than importing from
// src/lib/submitQuoteRequest.ts — that file backs the production QuoteForm
// and this milestone must not touch it (CLAUDE.md Production-Protected
// Systems / this milestone's explicit "do not modify QuoteForm" scope).
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ZIP_PATTERN = /^\d{5}(-\d{4})?$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const PROPERTY_TYPES = new Set(["home", "apartment", "airbnb", "restaurant", "office"]);
const CLEANING_TYPES = new Set(["standard", "deep", "move"]);
const CONDITIONS = new Set(["light", "moderate", "heavy", "extensive"]);
const FREQUENCIES = new Set(["one_time", "weekly", "biweekly", "every_4_weeks"]);
const LEAD_SOURCES = new Set<LeadSource>([
  "google",
  "facebook_instagram",
  "referral",
  "apartment_flyer_business_card",
  "returning_customer",
  "other",
]);
const VALID_ADD_ON_IDS = new Set(Object.keys(ADD_ON_CATALOG));

function isValidCalendarDate(value: string): boolean {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

function isValidAddOnIdList(ids: unknown): ids is AddOnId[] {
  return Array.isArray(ids) && ids.every((id) => typeof id === "string" && VALID_ADD_ON_IDS.has(id));
}

export type ValidateInstantQuoteInputResult =
  | { valid: true; value: ValidatedInstantQuoteInput }
  | { valid: false; errors: string[] };

/**
 * Server-side format validation only — never trusts client-calculated
 * pricing, discounts, eligibility, normalized identities, or any pricing
 * snapshot (none of those fields even exist on InstantQuoteRawInput). Does
 * not duplicate pricing business rules already enforced by
 * calculateEstimate (e.g. Standard+Extensive) — those surface as a
 * manual-review result later in the flow, not a validation error here.
 */
export function validateInstantQuoteInput(raw: InstantQuoteRawInput): ValidateInstantQuoteInputResult {
  const errors: string[] = [];

  const name = raw.name?.trim() ?? "";
  if (name.length < 2 || name.length > 100) {
    errors.push("name must be between 2 and 100 characters");
  }

  const rawPhone = raw.phone?.trim() ?? "";
  let phone: string | null = null;
  if (rawPhone.length > 0) {
    if (!normalizePhone(rawPhone).valid) {
      errors.push("phone is not a recognized U.S. phone number");
    } else {
      phone = rawPhone;
    }
  }

  const rawEmail = raw.email?.trim() ?? "";
  let email: string | null = null;
  if (rawEmail.length > 0) {
    if (rawEmail.length > 254 || !EMAIL_PATTERN.test(rawEmail)) {
      errors.push("email is not a valid email address");
    } else {
      email = rawEmail;
    }
  }

  if (phone === null && email === null) {
    errors.push("at least one contact method (email or phone) is required");
  }

  if (!PROPERTY_TYPES.has(raw.propertyType)) {
    errors.push("propertyType is not a recognized value");
  }

  if (!CLEANING_TYPES.has(raw.cleaningType)) {
    errors.push("cleaningType is not a recognized value");
  }

  if (!CONDITIONS.has(raw.condition)) {
    errors.push("condition is not a recognized value");
  }

  const rooms = raw.rooms;
  if (
    !rooms ||
    !Number.isInteger(rooms.bedrooms) ||
    rooms.bedrooms < 0 ||
    !Number.isInteger(rooms.fullBathrooms) ||
    rooms.fullBathrooms < 0 ||
    !Number.isInteger(rooms.halfBathrooms) ||
    rooms.halfBathrooms < 0
  ) {
    errors.push("rooms.bedrooms/fullBathrooms/halfBathrooms must be non-negative integers");
  }

  let squareFeet: number | null = null;
  if (raw.squareFeet !== undefined) {
    if (!Number.isInteger(raw.squareFeet) || raw.squareFeet <= 0) {
      errors.push("squareFeet must be a positive integer when provided");
    } else {
      squareFeet = raw.squareFeet;
    }
  }

  const zip = raw.serviceAddress?.zip?.trim() ?? "";
  if (!ZIP_PATTERN.test(zip)) {
    errors.push("serviceAddress.zip must be a 5-digit (or ZIP+4) U.S. ZIP code");
  }

  const line1 = raw.serviceAddress?.line1?.trim() ?? "";
  const line2 = raw.serviceAddress?.line2?.trim() ?? "";
  const city = raw.serviceAddress?.city?.trim() ?? "";
  const state = raw.serviceAddress?.state?.trim() ?? "";

  if (!FREQUENCIES.has(raw.frequency)) {
    errors.push("frequency is not a recognized value");
  }

  if (typeof raw.isPrepaidPackage !== "boolean") {
    errors.push("isPrepaidPackage must be a boolean");
  }

  if (!Number.isInteger(raw.visitCount) || raw.visitCount < 1) {
    errors.push("visitCount must be a positive integer");
  }

  if (!isValidAddOnIdList(raw.addOnIds)) {
    errors.push("addOnIds contains an unrecognized add-on");
  }

  let visitAddOns: AddOnId[][] | null = null;
  if (raw.visitAddOns !== undefined) {
    if (!Array.isArray(raw.visitAddOns) || !raw.visitAddOns.every((entry) => isValidAddOnIdList(entry))) {
      errors.push("visitAddOns must be an array of add-on id arrays, each containing only recognized add-ons");
    } else {
      visitAddOns = raw.visitAddOns;
    }
  }

  let preferredDate: string | null = null;
  const rawPreferredDate = raw.preferredDate?.trim() ?? "";
  if (rawPreferredDate.length > 0) {
    if (!DATE_PATTERN.test(rawPreferredDate) || !isValidCalendarDate(rawPreferredDate)) {
      errors.push("preferredDate must be a valid YYYY-MM-DD calendar date");
    } else {
      preferredDate = rawPreferredDate;
    }
  }

  let message: string | null = null;
  const rawMessage = raw.message?.trim() ?? "";
  if (rawMessage.length > 0) {
    if (rawMessage.length > 2000) {
      errors.push("message must be 2000 characters or fewer");
    } else {
      message = rawMessage;
    }
  }

  let leadSource: LeadSource | null = null;
  if (raw.leadSource !== undefined) {
    if (!LEAD_SOURCES.has(raw.leadSource)) {
      errors.push("leadSource is not a recognized value");
    } else {
      leadSource = raw.leadSource;
    }
  }

  let leadSourceDetail: string | null = null;
  const rawLeadSourceDetail = raw.leadSourceDetail?.trim() ?? "";
  if (rawLeadSourceDetail.length > 0) {
    if (rawLeadSourceDetail.length > 500) {
      errors.push("leadSourceDetail must be 500 characters or fewer");
    } else {
      leadSourceDetail = rawLeadSourceDetail;
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    value: {
      propertyType: raw.propertyType,
      cleaningType: raw.cleaningType,
      condition: raw.condition,
      rooms: { ...rooms },
      squareFeet,
      frequency: raw.frequency,
      isPrepaidPackage: raw.isPrepaidPackage,
      visitCount: raw.visitCount,
      addOnIds: [...raw.addOnIds],
      visitAddOns,
      name,
      phone,
      email,
      serviceAddress: {
        line1: line1.length > 0 ? line1 : null,
        line2: line2.length > 0 ? line2 : null,
        city: city.length > 0 ? city : null,
        state: state.length > 0 ? state : null,
        zip,
      },
      preferredDate,
      message,
      leadSource,
      leadSourceDetail,
    },
  };
}
