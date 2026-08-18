"use server";

import { SITE_CONTACT } from "@/lib/site-contact";
import { buildInstantQuoteEmailDetails } from "./email/build-email-details";
import { createResendInstantQuoteEmailSender } from "./email/resend-instant-quote-email-sender";
import { mapToCustomerSafeResult, type InstantQuoteRequestResult } from "./instant-quote-request-result";
import { createSupabaseInstantQuoteRepository } from "./supabase-repository";
import { submitInstantQuote } from "./submit-instant-quote";
import type { InstantQuoteRawInput } from "./types";

const GENERIC_ERROR_MESSAGE = `We couldn't process your quote request. Please try again or call/text us at ${SITE_CONTACT.phoneDisplay}.`;

/**
 * The production entry point for a future customer instant-quote
 * submission. Accepts only raw customer selections/contact information —
 * InstantQuoteRawInput has no authoritative field (asOf, entryChannel,
 * calculatedTotal, pricingSnapshot, normalized identities, customerId,
 * eligibility, etc.) for a hostile caller to smuggle in; the trusted core
 * (submitInstantQuote) recomputes everything server-side regardless of what
 * extra properties a raw object might carry.
 *
 * Does not duplicate normalization, customer resolution, eligibility,
 * pricing, range math, discount logic, or persistence mapping — all of that
 * is delegated entirely to the already-approved submitInstantQuote core.
 * This wrapper's only jobs are: construct the real repository, call the
 * core, and — only once persistence has already succeeded — attempt the
 * admin and customer emails from that same trusted result.
 *
 * Email failure policy: a successfully persisted quote is never rolled
 * back, hidden, or turned into a failure response just because Resend
 * fails. Both emails are attempted independently (Promise.allSettled) and
 * every failure mode is logged server-side only — no provider/API detail
 * ever reaches the customer-safe return value.
 */
export async function submitInstantQuoteRequest(
  rawInput: InstantQuoteRawInput
): Promise<InstantQuoteRequestResult> {
  let repo;
  try {
    repo = createSupabaseInstantQuoteRepository();
  } catch (err) {
    console.error(
      `[instant-quote-request] repository creation failed; message=${err instanceof Error ? err.message : "unknown"}`
    );
    return { success: false, stage: "failed", message: GENERIC_ERROR_MESSAGE };
  }

  // internalDependencies.asOf is intentionally omitted here — production
  // always uses the real server clock, per the core's own contract.
  const result = await submitInstantQuote(rawInput, { repo });

  if (!result.ok) {
    if (result.stage === "validation") {
      return { success: false, stage: "validation", errors: result.errors };
    }
    console.error(`[instant-quote-request] core failed; stage=${result.stage} detail=${result.error}`);
    return { success: false, stage: "failed", message: GENERIC_ERROR_MESSAGE };
  }

  console.info(
    `[instant-quote-request] quote persisted; quoteId=${result.quoteId} estimateType=${result.estimateType}`
  );

  // The quote already exists at this point. Everything below is
  // best-effort notification — its failure must never turn this into a
  // failed submission for the customer (same philosophy already
  // established for the legacy flow in quote-request-emails.ts).
  try {
    const emailSender = createResendInstantQuoteEmailSender();
    const details = buildInstantQuoteEmailDetails(rawInput, result);
    const hasCustomerEmail = details.email !== null;

    // Admin notification is always attempted regardless of whether the
    // customer supplied an email — business notification never depends on
    // customer email availability (phone-only submissions are valid).
    const [adminOutcome, customerOutcome] = await Promise.allSettled([
      emailSender.sendAdminNotification(details),
      hasCustomerEmail
        ? emailSender.sendCustomerConfirmation(details)
        : Promise.resolve({ attempted: false, sent: false }),
    ]);

    if (adminOutcome.status === "fulfilled") {
      console.info(
        `[instant-quote-request] admin notification attempted; quoteId=${result.quoteId} configured=${adminOutcome.value.configured} attempted=${adminOutcome.value.attempted} sent=${adminOutcome.value.sent}`
      );
    } else {
      console.error(
        `[instant-quote-request] admin notification threw unexpectedly; quoteId=${result.quoteId}`
      );
    }

    if (customerOutcome.status === "fulfilled") {
      if (hasCustomerEmail) {
        console.info(
          `[instant-quote-request] customer confirmation attempted; quoteId=${result.quoteId} sent=${customerOutcome.value.sent}`
        );
      }
    } else {
      console.error(
        `[instant-quote-request] customer confirmation threw unexpectedly; quoteId=${result.quoteId}`
      );
    }
  } catch (err) {
    console.error(
      `[instant-quote-request] email dispatch failed unexpectedly; quoteId=${result.quoteId} message=${err instanceof Error ? err.message : "unknown"}`
    );
  }

  return mapToCustomerSafeResult(result);
}
