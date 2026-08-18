"use server";

import { buildCalculationInput } from "./build-calculation-input";
import { calculateEstimateWithComparison } from "./estimate-with-comparison";
import { checkFirstCleaningEligibility } from "./first-cleaning-eligibility";
import { buildServiceAddressIdentity } from "./normalize-address";
import { normalizeEmail } from "./normalize-email";
import { normalizePhone } from "./normalize-phone";
import {
  mapToCustomizationPreviewResult,
  type InstantQuoteCustomizationPreviewResult,
} from "./preview-instant-quote-customization-result";
import { createSupabaseInstantQuoteRepository } from "./supabase-repository";
import type { InstantQuoteRawInput } from "./types";
import { validateInstantQuoteInput } from "./validate-input";

const GENERIC_ERROR_MESSAGE = "We couldn't update your estimate right now. Please try again.";

/**
 * A READ/CALCULATION preview only, for the post-estimate "Customize your
 * cleaning" step. Takes the customer's original raw selections plus their
 * updated add-on choices (addOnIds / visitAddOns — same
 * InstantQuoteRawInput shape the initial estimate used) and reruns the
 * real production pricing engine with server-authoritative eligibility.
 * Deliberately does NOT:
 *   - insert another quote_request (no repo.insertQuoteRequest call)
 *   - create or update a customer (no resolveCustomer/createCustomer/
 *     updateCustomerContact call — only the read-only eligibility check is
 *     used from the repository)
 *   - send any email
 *   - create a booking or payment (neither exists yet)
 * Reuses every piece of existing logic (validation, normalization,
 * eligibility, the pricing engine, the regular-vs-discounted comparison)
 * rather than duplicating any of it — see estimate-with-comparison.ts.
 */
export async function previewInstantQuoteCustomization(
  rawInput: InstantQuoteRawInput
): Promise<InstantQuoteCustomizationPreviewResult> {
  const validation = validateInstantQuoteInput(rawInput);
  if (!validation.valid) {
    return { success: false, stage: "validation", errors: validation.errors };
  }
  const validated = validation.value;

  try {
    const repo = createSupabaseInstantQuoteRepository();

    const emailNormalized = validated.email ? normalizeEmail(validated.email) : null;
    const phoneNormalizeResult = validated.phone ? normalizePhone(validated.phone) : null;
    const phoneNormalized = phoneNormalizeResult?.valid ? phoneNormalizeResult.e164 : null;
    const serviceAddressIdentity = buildServiceAddressIdentity({
      zip: validated.serviceAddress.zip,
      line1: validated.serviceAddress.line1 ?? "",
      line2: validated.serviceAddress.line2 ?? undefined,
    });

    // Read-only: only checkFirstCleaningEligibility's repo methods are
    // used. No customer lookup/create/update happens in a preview.
    const eligibility = await checkFirstCleaningEligibility(
      { emailNormalized, phoneNormalized, serviceAddressIdentity },
      repo
    );

    const calculationInput = buildCalculationInput(validated, eligibility.eligible, new Date());
    const estimate = calculateEstimateWithComparison(calculationInput);

    return mapToCustomizationPreviewResult(estimate);
  } catch (err) {
    console.error(
      `[instant-quote-preview] preview failed unexpectedly; message=${err instanceof Error ? err.message : "unknown"}`
    );
    return { success: false, stage: "failed", message: GENERIC_ERROR_MESSAGE };
  }
}
