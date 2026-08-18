import { normalizePhone } from "@/lib/instant-quote/normalize-phone";

// Client-side pre-checks only, for immediate inline feedback — never
// authoritative. The server (validateInstantQuoteInput, called inside
// submitInstantQuoteRequest/previewInstantQuoteCustomization) re-validates
// everything regardless of what passes here.

const ZIP_PATTERN = /^\d{5}(-\d{4})?$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface StepOneErrors {
  zip?: string;
}

export function validateStepOne(zip: string): StepOneErrors {
  const trimmed = zip.trim();
  if (!ZIP_PATTERN.test(trimmed)) {
    return { zip: "Enter a valid 5-digit ZIP code." };
  }
  return {};
}

export function isStepOneValid(zip: string): boolean {
  return Object.keys(validateStepOne(zip)).length === 0;
}

export interface StepTwoContactInput {
  firstName: string;
  phone: string;
  email: string;
  addressLine1: string;
  city: string;
}

export interface StepTwoErrors {
  firstName?: string;
  phone?: string;
  email?: string;
  addressLine1?: string;
  city?: string;
}

export function validateStepTwo(input: StepTwoContactInput): StepTwoErrors {
  const errors: StepTwoErrors = {};

  if (input.firstName.trim().length < 2) {
    errors.firstName = "Enter your first name.";
  }

  const phone = input.phone.trim();
  if (phone.length === 0) {
    errors.phone = "Phone number is required.";
  } else if (!normalizePhone(phone).valid) {
    errors.phone = "Enter a valid U.S. phone number.";
  }

  const email = input.email.trim();
  if (email.length > 0 && !EMAIL_PATTERN.test(email)) {
    errors.email = "Enter a valid email address.";
  }

  if (input.addressLine1.trim().length === 0) {
    errors.addressLine1 = "Service address is required.";
  }

  if (input.city.trim().length === 0) {
    errors.city = "City is required.";
  }

  return errors;
}

export function isStepTwoValid(input: StepTwoContactInput): boolean {
  return Object.keys(validateStepTwo(input)).length === 0;
}
