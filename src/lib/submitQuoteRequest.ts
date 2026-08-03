"use server";

import { randomUUID } from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  sendAdminQuoteRequestNotification,
  sendCustomerQuoteRequestEmail,
} from "@/lib/email/quote-request-emails";
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

interface SupabaseErrorLike {
  code?: string;
  message?: string;
  details?: string | null;
  hint?: string | null;
}

function logSupabaseError(operation: string, error: SupabaseErrorLike) {
  console.error(
    `[quote-submission] supabase error; operation=${operation} code=${error.code ?? "unknown"} message=${error.message ?? "unknown"} details=${error.details ?? "none"} hint=${error.hint ?? "none"}`
  );
}

export async function submitQuoteRequest(
  payload: QuoteRequestPayload
): Promise<SubmitQuoteRequestResult> {
  const validated = validatePayload(payload);
  if (!validated) {
    console.warn("[quote-submission] validation failed");
    return { ok: false, message: GENERIC_ERROR_MESSAGE };
  }

  let supabase: ReturnType<typeof createSupabaseAdminClient>;
  try {
    supabase = createSupabaseAdminClient();
  } catch (clientError) {
    console.error(
      `[quote-submission] supabase admin client creation failed; message=${clientError instanceof Error ? clientError.message : "unknown"}`
    );
    return { ok: false, message: GENERIC_ERROR_MESSAGE };
  }

  // Generated here rather than read back from the database: service_role
  // only has INSERT on quote_requests (no SELECT/RETURNING), so a
  // `.select()` after `.insert()` fails with a Postgres permission error
  // and the row is never written. Supplying our own id/created_at lets us
  // know both values without requiring a privilege this table doesn't grant.
  const id = randomUUID();
  const createdAt = new Date().toISOString();

  try {
    const { error } = await supabase.from("quote_requests").insert({
      id,
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
      logSupabaseError("insert", error);
      return { ok: false, message: GENERIC_ERROR_MESSAGE };
    }

    console.info(`[quote-submission] insert succeeded; quoteId=${id}`);
  } catch (err) {
    console.error(
      `[quote-submission] insert request threw unexpectedly; message=${err instanceof Error ? err.message : "unknown"}`
    );
    return { ok: false, message: GENERIC_ERROR_MESSAGE };
  }

  // The database save already succeeded at this point. Everything below is
  // best-effort notification — each path is independent, and neither path's
  // failure may turn this into a failed submission for the customer.
  const emailDetails = {
    id,
    createdAt,
    name: validated.name,
    phone: validated.phone,
    email: validated.email,
    zip: validated.zip,
    propertyType: validated.propertyType,
    serviceId: validated.serviceId,
    preferredDate: validated.preferredDate,
    message: validated.message,
  };

  try {
    const summary = await sendAdminQuoteRequestNotification(emailDetails);
    console.info(
      `[quote-submission] admin notification attempted; quoteId=${id} configured=${summary.configured} attempted=${summary.attempted} sent=${summary.sent}`
    );
  } catch {
    console.error(`[quote-submission] admin notification threw unexpectedly; quoteId=${id}`);
  }

  try {
    const customerResult = await sendCustomerQuoteRequestEmail(emailDetails);
    console.info(
      `[quote-submission] customer email attempted; quoteId=${id} attempted=true sent=${customerResult.sent}${
        customerResult.failureCategory ? ` category=${customerResult.failureCategory}` : ""
      }`
    );
  } catch {
    console.error(`[quote-submission] customer email threw unexpectedly; quoteId=${id}`);
  }

  return { ok: true };
}
