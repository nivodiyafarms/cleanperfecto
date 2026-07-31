"use server";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type {
  QuoteRequestPayload,
  SubmitQuoteRequestResult,
} from "@/lib/quote-request-types";

const GENERIC_ERROR_MESSAGE =
  "We could not submit your request. Please try again or call us at +1 (469) 645-8753.";

const PROPERTY_TYPES = new Set(["home", "airbnb", "restaurant", "office"]);
const SERVICE_IDS = new Set(["standard", "deep", "move", "recurring"]);

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN = /^[0-9()+\-.\s]{7,30}$/;
const ZIP_PATTERN = /^\d{5}(-\d{4})?$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

interface ValidatedQuoteRequest {
  name: string;
  phone: string;
  email: string;
  zip: string;
  propertyType: string;
  serviceId: string;
  preferredDate: string | null;
  message: string | null;
}

function isValidCalendarDate(value: string): boolean {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function validatePayload(
  payload: QuoteRequestPayload
): ValidatedQuoteRequest | null {
  const name = payload.name.trim();
  if (name.length < 2 || name.length > 100) {
    return null;
  }

  const phone = payload.phone.trim();
  if (!PHONE_PATTERN.test(phone) || !/\d/.test(phone)) {
    return null;
  }

  const email = payload.email.trim().toLowerCase();
  if (email.length === 0 || email.length > 254 || !EMAIL_PATTERN.test(email)) {
    return null;
  }

  const zip = payload.zip.trim();
  if (!ZIP_PATTERN.test(zip)) {
    return null;
  }

  if (!PROPERTY_TYPES.has(payload.propertyType)) {
    return null;
  }

  if (!SERVICE_IDS.has(payload.serviceId)) {
    return null;
  }

  const preferredDateRaw = payload.preferredDate.trim();
  let preferredDate: string | null = null;
  if (preferredDateRaw.length > 0) {
    if (!DATE_PATTERN.test(preferredDateRaw) || !isValidCalendarDate(preferredDateRaw)) {
      return null;
    }
    preferredDate = preferredDateRaw;
  }

  const messageRaw = payload.message.trim();
  let message: string | null = null;
  if (messageRaw.length > 0) {
    if (messageRaw.length > 2000) {
      return null;
    }
    message = messageRaw;
  }

  return {
    name,
    phone,
    email,
    zip,
    propertyType: payload.propertyType,
    serviceId: payload.serviceId,
    preferredDate,
    message,
  };
}

export async function submitQuoteRequest(
  payload: QuoteRequestPayload
): Promise<SubmitQuoteRequestResult> {
  const validated = validatePayload(payload);
  if (!validated) {
    return { ok: false, message: GENERIC_ERROR_MESSAGE };
  }

  try {
    const supabase = createSupabaseAdminClient();
    const { error } = await supabase.from("quote_requests").insert({
      name: validated.name,
      phone: validated.phone,
      email: validated.email,
      zip: validated.zip,
      property_type: validated.propertyType,
      service_id: validated.serviceId,
      preferred_date: validated.preferredDate,
      message: validated.message,
    });

    if (error) {
      return { ok: false, message: GENERIC_ERROR_MESSAGE };
    }

    return { ok: true };
  } catch {
    return { ok: false, message: GENERIC_ERROR_MESSAGE };
  }
}
