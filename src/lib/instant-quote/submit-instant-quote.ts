import "server-only";

import { randomUUID } from "node:crypto";
import { calculateEstimate } from "@/lib/pricing/calculate-estimate";
import type { EstimateRange } from "@/lib/pricing/types";
import { buildCalculationInput } from "./build-calculation-input";
import { buildQuoteRequestRow } from "./build-quote-request-row";
import { buildCustomerContactRefreshPatch } from "./contact-refresh";
import { resolveLegacyServiceId } from "./legacy-service-id";
import { checkFirstCleaningEligibility } from "./first-cleaning-eligibility";
import { buildServiceAddressIdentity } from "./normalize-address";
import { normalizeEmail } from "./normalize-email";
import { normalizePhone } from "./normalize-phone";
import { resolveCustomer } from "./resolve-customer";
import type { InstantQuoteRepository } from "./repository";
import type { InstantQuoteManualReviewReasonCode, InstantQuoteRawInput } from "./types";
import { validateInstantQuoteInput } from "./validate-input";

/**
 * Trusted, server-only dependencies — never derived from the raw public
 * payload. `repo` has no safe default (it always talks to a real or fake
 * data store) so it's required, not optional; `asOf` is a deterministic
 * clock override that exists purely for tests — production callers omit it
 * and the server's real current time (`new Date()`) is used, which is what
 * getActiveFirstCleaningOffer bases the 30%/25% decision on. Neither field
 * is ever read from rawPublicInput — that type has no `asOf` and no
 * `entryChannel` field at all, so there is nothing for a malicious payload
 * to smuggle in even if it tried (see the security/trust tests).
 */
export interface SubmitInstantQuoteInternalDependencies {
  repo: InstantQuoteRepository;
  /** Deterministic clock override — test-only. Production omits this. */
  asOf?: Date;
}

export type SubmitInstantQuoteResult =
  | {
      ok: true;
      quoteId: string;
      /** Null on a create (customer not yet visible outside this call) or an identity conflict — never another customer's UUID. */
      customerId: string | null;
      identityConflict: boolean;
      estimateType: "instant_range" | "manual_review";
      calculatedTotal: number;
      range: EstimateRange | null;
      hasStartingAtPricing: boolean;
      prepaidPackageTotal: number | null;
      effectivePricePerVisit: number | null;
      manualReviewRequired: boolean;
      manualReviewReasons: InstantQuoteManualReviewReasonCode[];
    }
  | { ok: false; stage: "validation"; errors: string[] }
  | { ok: false; stage: "persistence"; error: string }
  | { ok: false; stage: "unexpected"; error: string };

/**
 * The trusted server-side instant-quote core for the future public website
 * submission (not yet wired into any route). entry_channel is always
 * "website" here — this function is specifically the public-website entry
 * point, so it is hardcoded below rather than accepted as a parameter at
 * all. A future internal/admin flow (phone/text/admin-created leads) would
 * need its own separate, trusted server code path — never this same
 * function with a different caller-supplied channel.
 *
 * Order of operations, per the approved milestone:
 *  1. Validate raw input
 *  2. Normalize email/phone/service-address identity
 *  3. Resolve or create the customer
 *  4. Refresh the matched customer's contact info, per the safer
 *     per-match-kind rules in contact-refresh.ts (matched case only —
 *     skipped entirely on conflict or create)
 *  5. Check first-cleaning eligibility from completed service_visits only
 *  6. Run the real production pricing engine (which itself resolves the
 *     active first-cleaning offer server-side via getActiveFirstCleaningOffer,
 *     using the server's own clock — never a client-supplied date)
 *  7. Build the DB snapshot/row and persist quote_request
 *  8. Return a safe typed result
 *
 * Design decision on identity conflict: a conflict does NOT abort the flow.
 * Eligibility and pricing still run (they don't require a resolved
 * customer_id), and the quote is still persisted with customer_id = NULL,
 * the submitted contact info intact, "CUSTOMER_IDENTITY_CONFLICT" appended
 * to manual_review_reasons, and estimate_type forced to "manual_review"
 * regardless of what the pricing engine itself computed — so a conflicted
 * request can never look like an ordinary automatic instant quote, even
 * though the underlying calculated figures are still persisted as
 * informational context. Neither conflicting customer is updated, and no
 * third customer is created. The public-safe SubmitInstantQuoteResult never
 * includes either conflicting customer's UUID — only resolveCustomer's
 * internal ResolveCustomerResult (never returned from this function) does.
 */
export async function submitInstantQuote(
  rawPublicInput: InstantQuoteRawInput,
  internalDependencies: SubmitInstantQuoteInternalDependencies
): Promise<SubmitInstantQuoteResult> {
  const { repo, asOf = new Date() } = internalDependencies;

  try {
    const validation = validateInstantQuoteInput(rawPublicInput);
    if (!validation.valid) {
      return { ok: false, stage: "validation", errors: validation.errors };
    }
    const validated = validation.value;

    const emailNormalized = validated.email ? normalizeEmail(validated.email) : null;
    const phoneNormalizeResult = validated.phone ? normalizePhone(validated.phone) : null;
    const phoneNormalized = phoneNormalizeResult?.valid ? phoneNormalizeResult.e164 : null;
    const serviceAddressIdentity = buildServiceAddressIdentity({
      zip: validated.serviceAddress.zip,
      line1: validated.serviceAddress.line1 ?? "",
      line2: validated.serviceAddress.line2 ?? undefined,
    });

    const resolution = await resolveCustomer(
      {
        name: validated.name,
        email: validated.email,
        emailNormalized,
        phone: validated.phone,
        phoneNormalized,
      },
      repo
    );

    let customerId: string | null;
    const additionalManualReviewReasons: InstantQuoteManualReviewReasonCode[] = [];
    const identityConflict = resolution.outcome === "conflict";

    if (resolution.outcome === "conflict") {
      customerId = null;
      additionalManualReviewReasons.push("CUSTOMER_IDENTITY_CONFLICT");
    } else {
      customerId = resolution.customer.id;
      if (resolution.outcome === "matched") {
        const patch = buildCustomerContactRefreshPatch({
          matchedBy: resolution.matchedBy,
          existingCustomer: resolution.customer,
          name: validated.name,
          email: validated.email,
          emailNormalized,
          phone: validated.phone,
          phoneNormalized,
        });
        if (Object.keys(patch).length > 0) {
          await repo.updateCustomerContact(customerId, patch);
        }
      }
    }

    const eligibility = await checkFirstCleaningEligibility(
      { emailNormalized, phoneNormalized, serviceAddressIdentity },
      repo
    );

    const calculationInput = buildCalculationInput(validated, eligibility.eligible, asOf);
    const calculationResult = calculateEstimate(calculationInput);

    const legacyServiceId = resolveLegacyServiceId(validated.cleaningType, validated.frequency);

    const row = buildQuoteRequestRow({
      id: randomUUID(),
      customerId,
      entryChannel: "website",
      validated,
      emailNormalized,
      phoneNormalized,
      serviceAddressIdentity,
      legacyServiceId,
      calculationInput,
      calculationResult,
      additionalManualReviewReasons,
      forceManualReview: identityConflict,
    });

    const insertResult = await repo.insertQuoteRequest(row);
    if (!insertResult.ok) {
      return { ok: false, stage: "persistence", error: insertResult.error };
    }

    return {
      ok: true,
      quoteId: row.id,
      customerId,
      identityConflict,
      estimateType: row.estimate_type,
      calculatedTotal: calculationResult.calculatedTotal,
      range: calculationResult.range,
      hasStartingAtPricing: calculationResult.hasStartingAtPricing,
      prepaidPackageTotal: calculationResult.prepaidPackageTotal,
      effectivePricePerVisit: calculationResult.effectivePricePerVisit,
      manualReviewRequired: calculationResult.manualReviewRequired || identityConflict,
      manualReviewReasons: row.manual_review_reasons,
    };
  } catch (err) {
    return {
      ok: false,
      stage: "unexpected",
      error: err instanceof Error ? err.message : "unknown error",
    };
  }
}
