"use server";

import { redirect } from "next/navigation";
import { checkFirstCleaningEligibility } from "@/lib/instant-quote/first-cleaning-eligibility";
import { calculateEstimate } from "@/lib/pricing/calculate-estimate";
import { assertCanCreateStripeSetup } from "@/lib/config/payment-capabilities";
import { RuntimeConfigurationError } from "@/lib/config/runtime-env";
import { SITE_CONTACT } from "@/lib/site-contact";
import { acceptConsentClickwrap } from "@/lib/consent/accept-consent-clickwrap";
import { captureAuditHeaders } from "@/lib/consent/capture-audit-headers";
import { createSupabaseConsentRepository } from "@/lib/consent/consent-repository";
import { ConsentVersionChangedError, InvalidConsentStateError } from "@/lib/consent/errors";
import { createSupabaseSchedulingRepository } from "@/lib/scheduling/supabase-scheduling-repository";
import { CANCELLATION_POLICY_VERSION, SAVED_PAYMENT_AUTHORIZATION_COPY, formatCancellationPolicySnapshot } from "./cancellation-policy";
import { getOrCreateCheckoutSessionUrl } from "./create-checkout-attempt";
import { getQuoteForBooking } from "./get-quote-for-booking";
import { getSiteUrl } from "./site-url";
import { createSetupCheckoutSession } from "./stripe/checkout-sessions";
import { getStripeClient } from "./stripe/client";
import { resolveStripeCustomerId } from "./stripe/customers";
import { createSupabaseBookingRepository } from "./supabase-booking-repository";
import type { ConsentVersionSummary, NormalBookingSelectionInput, NotBookableReason } from "./types";
import { validateNormalBookingSelection } from "./validate-normal-booking-selection";
import {
  validateAddOnIds,
  validateMovePackageLevel,
  validateOutdoorSelection,
  validateQuantifiedAddOns,
  validateSpecialRooms,
} from "./validate-customization-selection";

const GENERIC_ERROR_MESSAGE = `We couldn't start your booking right now. Please try again or contact CleanPerfecto at ${SITE_CONTACT.phoneDisplay}.`;
/** Customer-safe — never repeats internal configuration jargon (PAYMENT_MODE) to the customer. */
const PAYMENT_TEMPORARILY_UNAVAILABLE_MESSAGE = `Online booking is temporarily unavailable. Please contact CleanPerfecto at ${SITE_CONTACT.phoneDisplay} to schedule.`;

export type CreateNormalBookingCheckoutResult =
  | { ok: false; stage: "validation"; errors: string[] }
  | { ok: false; stage: "not_bookable"; reason: NotBookableReason }
  | { ok: false; stage: "consent_changed"; currentVersion: ConsentVersionSummary }
  | { ok: false; stage: "failed"; message: string };
// ok:true is never returned — success ends in redirect(), which throws
// internally and is handled by the framework, not returned to the caller.

/**
 * Server action for the Normal Cleaning booking path: recomputes pricing
 * server-side for the chosen frequency (never trusting a client-supplied
 * price), freezes a booking order, and redirects to a Stripe Checkout
 * Session in `setup` mode — no charge, only a saved payment method. See
 * the approved Booking + Payment Phase 1 plan for the full trust-boundary
 * and idempotency design this implements.
 */
export async function createNormalBookingCheckout(
  raw: NormalBookingSelectionInput
): Promise<CreateNormalBookingCheckoutResult> {
  const errors = validateNormalBookingSelection(raw);
  if (errors.length > 0) {
    return { ok: false, stage: "validation", errors };
  }

  const repo = createSupabaseBookingRepository();
  const quoteResult = await getQuoteForBooking(raw.quoteId, repo);
  if (!quoteResult.ok) {
    return { ok: false, stage: "not_bookable", reason: quoteResult.reason };
  }
  const quote = quoteResult.quote;

  const addOnIds = validateAddOnIds(raw.addOnIds);
  const specialRooms = validateSpecialRooms(raw.specialRooms);
  const movePackageLevel = validateMovePackageLevel(raw.movePackageLevel);
  const outdoorSelection = validateOutdoorSelection(raw.outdoorSelection);
  const quantifiedAddOns = validateQuantifiedAddOns(raw.quantifiedAddOns);

  let sessionUrl: string;
  try {
    // Every normal booking creates a setup-mode Checkout Session (no
    // charge) — checked before any state mutation below so a disabled
    // PAYMENT_MODE never leaves a half-created booking order behind.
    assertCanCreateStripeSetup();

    const asOf = new Date();

    const eligibility = await checkFirstCleaningEligibility(
      {
        emailNormalized: quote.emailNormalized,
        phoneNormalized: quote.phoneNormalized,
        serviceAddressIdentity: quote.serviceAddressIdentity,
      },
      repo
    );

    const calculationInput = {
      ...quote.baseInput,
      frequency: raw.frequency,
      isPrepaidPackage: false,
      visitCount: 1,
      addOnIds,
      specialRooms,
      movePackageLevel,
      outdoorSelection,
      quantifiedAddOns,
      visitAddOns: undefined,
      firstCleaningEligible: eligibility.eligible,
      asOf,
    };
    const result = calculateEstimate(calculationInput);

    // Required clickwrap acceptance (Service Terms + Cancellation/
    // Rescheduling Policy + Payment Authorization) — recorded before the
    // booking order exists so a version-race rejection never leaves a
    // half-created booking behind. Idempotent: a retried submission with
    // the same clientRequestId simply finds the customer already signed
    // for the active version and returns unchanged.
    const { ipAddress, userAgent } = await captureAuditHeaders();
    // Captured (not discarded) so booking_orders.consent_version_id is
    // always the server-CONFIRMED active version — never the raw,
    // merely-validated client-supplied id — even though the two are
    // guaranteed equal by acceptConsentClickwrap's own check.
    const consentAcceptance = await acceptConsentClickwrap(createSupabaseConsentRepository(), createSupabaseSchedulingRepository(), {
      customerId: quote.customerId,
      presentedConsentVersionId: raw.presentedConsentVersionId,
      ipAddress,
      userAgent,
    });

    const bookingOrder = await repo.insertBookingOrder({
      customerId: quote.customerId,
      quoteRequestId: quote.quoteId,
      clientRequestId: raw.clientRequestId,
      bookingType: "normal",
      cleaningType: quote.cleaningType,
      frequency: raw.frequency,
      visitCount: 1,
      paymentAuthorizationAcceptedAt: asOf.toISOString(),
      pricingVersion: result.pricingVersion,
      pricingSnapshot: { input: calculationInput, result },
      calculatedTotal: result.calculatedTotal,
      displayRangeLower: result.range?.lower ?? null,
      displayRangeUpper: result.range?.upper ?? null,
      prepaidPackageTotal: null,
      effectivePricePerVisit: null,
      hasStartingAtPricing: result.hasStartingAtPricing,
      manualReviewReasons: result.manualReviewReasons,
      selectedAddOnIds: addOnIds,
      serviceAddressLine1: quote.serviceAddressLine1,
      serviceAddressLine2: quote.serviceAddressLine2,
      serviceCity: quote.serviceCity,
      serviceState: quote.serviceState,
      serviceAddressIdentity: quote.serviceAddressIdentity,
      requestedDate: raw.requestedDate,
      // Legacy enum column, no longer collected — see requestedStartTime.
      requestedTimeWindow: null,
      requestedStartTime: raw.requestedStartTime,
      cancellationPolicyVersion: CANCELLATION_POLICY_VERSION,
      // Frozen verbatim — durable evidence of the EXACT wording shown for
      // this booking's Payment Authorization, not just a version tag. See
      // 20260827090400's migration comment for why this exists alongside
      // cancellationPolicyVersion rather than replacing it.
      paymentAuthorizationTextSnapshot: SAVED_PAYMENT_AUTHORIZATION_COPY,
      // Booking-level evidence closing the last gap: which Service Terms
      // version applied, and the exact cancellation wording shown — both
      // server-derived, never accepted from raw client input.
      consentVersionId: consentAcceptance.consentVersionId,
      cancellationPolicyTextSnapshot: formatCancellationPolicySnapshot(false),
    });

    const stripe = getStripeClient();
    const stripeCustomerId = await resolveStripeCustomerId(
      stripe,
      quote.customerId,
      {
        line1: quote.serviceAddressLine1,
        line2: quote.serviceAddressLine2,
        city: quote.serviceCity,
        state: quote.serviceState,
        zip: quote.baseInput.zip,
      },
      repo
    );

    const siteUrl = getSiteUrl();
    sessionUrl = await getOrCreateCheckoutSessionUrl({
      repo,
      stripe,
      bookingOrderId: bookingOrder.id,
      mode: "setup",
      stripeCustomerId,
      amount: null,
      createSession: (idempotencyKey) =>
        createSetupCheckoutSession(stripe, {
          stripeCustomerId,
          bookingOrderId: bookingOrder.id,
          successUrl: `${siteUrl}/booking/${bookingOrder.id}`,
          cancelUrl: `${siteUrl}/quote/${quote.quoteId}/booking`,
          idempotencyKey,
        }),
    });

    // Idempotent — a no-op if a prior attempt already made this
    // transition (findActivePaymentAttempt above already reused that
    // attempt's session in that case).
    await repo.updateBookingOrderStatus(bookingOrder.id, "draft", "awaiting_payment_method");
  } catch (error) {
    if (error instanceof RuntimeConfigurationError) {
      return { ok: false, stage: "failed", message: PAYMENT_TEMPORARILY_UNAVAILABLE_MESSAGE };
    }
    if (error instanceof ConsentVersionChangedError) {
      const consentRepo = createSupabaseConsentRepository();
      const currentVersion = await consentRepo.findVersionById(error.currentVersionId);
      if (currentVersion) {
        return {
          ok: false,
          stage: "consent_changed",
          currentVersion: {
            id: currentVersion.id,
            versionLabel: currentVersion.versionLabel,
            title: currentVersion.title,
            bodyText: currentVersion.bodyText,
            isLegallyReviewed: currentVersion.isLegallyReviewed,
          },
        };
      }
      return { ok: false, stage: "failed", message: GENERIC_ERROR_MESSAGE };
    }
    if (error instanceof InvalidConsentStateError) {
      return { ok: false, stage: "failed", message: GENERIC_ERROR_MESSAGE };
    }
    return { ok: false, stage: "failed", message: GENERIC_ERROR_MESSAGE };
  }

  redirect(sessionUrl);
}
