"use server";

import { redirect } from "next/navigation";
import { checkFirstCleaningEligibility } from "@/lib/instant-quote/first-cleaning-eligibility";
import { calculateEstimate } from "@/lib/pricing/calculate-estimate";
import { assertCanCreateStripeCharge } from "@/lib/config/payment-capabilities";
import { RuntimeConfigurationError } from "@/lib/config/runtime-env";
import { SITE_CONTACT } from "@/lib/site-contact";
import { acceptConsentClickwrap } from "@/lib/consent/accept-consent-clickwrap";
import { captureAuditHeaders } from "@/lib/consent/capture-audit-headers";
import { createSupabaseConsentRepository } from "@/lib/consent/consent-repository";
import { ConsentVersionChangedError, InvalidConsentStateError } from "@/lib/consent/errors";
import { createSupabaseSchedulingRepository } from "@/lib/scheduling/supabase-scheduling-repository";
import { applyAchIncentive } from "./ach-incentive";
import { CANCELLATION_POLICY_VERSION, PREPAID_PAYMENT_AUTHORIZATION_COPY } from "./cancellation-policy";
import { getOrCreateCheckoutSessionUrl } from "./create-checkout-attempt";
import { getQuoteForBooking } from "./get-quote-for-booking";
import { PREPAID_FREQUENCY_LABELS } from "./labels";
import { getSiteUrl } from "./site-url";
import { createPrepaidAchCheckoutSession, createPrepaidCardCheckoutSession } from "./stripe/checkout-sessions";
import { getStripeClient } from "./stripe/client";
import { resolveStripeCustomerId } from "./stripe/customers";
import { createSupabaseBookingRepository } from "./supabase-booking-repository";
import type { ConsentVersionSummary, NotBookableReason, PrepaidBookingSelectionInput } from "./types";
import { validatePrepaidBookingSelection } from "./validate-prepaid-booking-selection";

const PREPAID_VISIT_COUNT = 6;

const GENERIC_ERROR_MESSAGE = `We couldn't start your package purchase right now. Please try again or contact CleanPerfecto at ${SITE_CONTACT.phoneDisplay}.`;
/** Customer-safe — never repeats internal configuration jargon (PAYMENT_MODE) to the customer. */
const PAYMENT_TEMPORARILY_UNAVAILABLE_MESSAGE = `Online prepaid package purchases are temporarily unavailable. Please contact CleanPerfecto at ${SITE_CONTACT.phoneDisplay}.`;

export type CreatePrepaidPackageCheckoutResult =
  | { ok: false; stage: "validation"; errors: string[] }
  | { ok: false; stage: "not_bookable"; reason: NotBookableReason }
  | { ok: false; stage: "manual_review_required" }
  | { ok: false; stage: "consent_changed"; currentVersion: ConsentVersionSummary }
  | { ok: false; stage: "failed"; message: string };
// ok:true is never returned — success ends in redirect().

/**
 * Server action for the 6+ Cleaning Prepaid Package path: recomputes the
 * package total server-side for the chosen frequency (never trusting a
 * client-supplied total), freezes a booking order, and redirects to a
 * Stripe Checkout Session in `payment` mode for the exact
 * prepaidPackageTotal, with Stripe Tax enabled. No add-ons are collected
 * here and no dates are requested — see the approved plan for why.
 */
export async function createPrepaidPackageCheckout(
  raw: PrepaidBookingSelectionInput
): Promise<CreatePrepaidPackageCheckoutResult> {
  const errors = validatePrepaidBookingSelection(raw);
  if (errors.length > 0) {
    return { ok: false, stage: "validation", errors };
  }

  const repo = createSupabaseBookingRepository();
  const quoteResult = await getQuoteForBooking(raw.quoteId, repo);
  if (!quoteResult.ok) {
    return { ok: false, stage: "not_bookable", reason: quoteResult.reason };
  }
  const quote = quoteResult.quote;

  let sessionUrl: string;
  try {
    // A prepaid package purchase is a real payment-mode Checkout Session —
    // checked before any state mutation below.
    assertCanCreateStripeCharge();

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
      isPrepaidPackage: true,
      visitCount: PREPAID_VISIT_COUNT,
      addOnIds: [],
      visitAddOns: undefined,
      firstCleaningEligible: eligibility.eligible,
      asOf,
    };
    const result = calculateEstimate(calculationInput);

    if (result.manualReviewRequired || result.prepaidPackageTotal === null || result.effectivePricePerVisit === null) {
      return { ok: false, stage: "manual_review_required" };
    }
    const prepaidPackageTotal = result.prepaidPackageTotal;

    // Required clickwrap acceptance — same architecture as the normal
    // booking path, worded for the prepaid payment model (see
    // PREPAID_PAYMENT_AUTHORIZATION_COPY). Recorded before the booking
    // order exists so a version-race rejection never leaves a
    // half-created booking behind.
    const { ipAddress, userAgent } = await captureAuditHeaders();
    await acceptConsentClickwrap(createSupabaseConsentRepository(), createSupabaseSchedulingRepository(), {
      customerId: quote.customerId,
      presentedConsentVersionId: raw.presentedConsentVersionId,
      ipAddress,
      userAgent,
    });

    const bookingOrder = await repo.insertBookingOrder({
      customerId: quote.customerId,
      quoteRequestId: quote.quoteId,
      clientRequestId: raw.clientRequestId,
      bookingType: "prepaid_package",
      cleaningType: quote.cleaningType,
      frequency: raw.frequency,
      visitCount: PREPAID_VISIT_COUNT,
      paymentAuthorizationAcceptedAt: null,
      pricingVersion: result.pricingVersion,
      pricingSnapshot: { input: calculationInput, result },
      calculatedTotal: result.calculatedTotal,
      displayRangeLower: result.range?.lower ?? null,
      displayRangeUpper: result.range?.upper ?? null,
      prepaidPackageTotal: result.prepaidPackageTotal,
      effectivePricePerVisit: result.effectivePricePerVisit,
      hasStartingAtPricing: result.hasStartingAtPricing,
      manualReviewReasons: result.manualReviewReasons,
      selectedAddOnIds: [],
      serviceAddressLine1: quote.serviceAddressLine1,
      serviceAddressLine2: quote.serviceAddressLine2,
      serviceCity: quote.serviceCity,
      serviceState: quote.serviceState,
      serviceAddressIdentity: quote.serviceAddressIdentity,
      requestedDate: null,
      requestedTimeWindow: null,
      requestedStartTime: null,
      // Still no saved-payment-method authorization checkbox for a prepaid
      // purchase — the Stripe Checkout payment itself is that
      // authorization. The disclosed cancellation/rescheduling/no-access
      // fee schedule now IS accepted here too (via the required consent
      // checkbox above), so its version is recorded like a normal booking.
      cancellationPolicyVersion: CANCELLATION_POLICY_VERSION,
      // Frozen verbatim — durable evidence of the EXACT prepaid-specific
      // Payment Authorization wording shown for this booking. See
      // 20260827090400's migration comment.
      paymentAuthorizationTextSnapshot: PREPAID_PAYMENT_AUTHORIZATION_COPY,
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
    // The trusted, already-10%-discounted card subtotal from the pricing
    // engine — never recomputed. The ACH incentive (a payment-method
    // incentive, not a pricing-engine rule — see ach-incentive.ts) is
    // layered on top of this exact number only when the customer chose
    // ACH; card pays this amount unchanged.
    const cardSubtotal = prepaidPackageTotal;
    const productName = `${PREPAID_FREQUENCY_LABELS[raw.frequency]} 6-Cleaning Prepaid Package`;
    const isAch = raw.paymentMethod === "us_bank_account";
    const achIncentive = isAch ? applyAchIncentive(cardSubtotal) : null;
    const chargedSubtotal = achIncentive ? achIncentive.achSubtotal : cardSubtotal;

    sessionUrl = await getOrCreateCheckoutSessionUrl({
      repo,
      stripe,
      bookingOrderId: bookingOrder.id,
      mode: "payment",
      stripeCustomerId,
      amount: chargedSubtotal,
      paymentMethodType: raw.paymentMethod,
      packageSubtotalBeforeAchIncentive: achIncentive ? cardSubtotal : null,
      achSavingsAmount: achIncentive ? achIncentive.achSavingsAmount : null,
      createSession: (idempotencyKey) =>
        isAch
          ? createPrepaidAchCheckoutSession(stripe, {
              stripeCustomerId,
              bookingOrderId: bookingOrder.id,
              packageSubtotal: chargedSubtotal,
              productName,
              successUrl: `${siteUrl}/booking/${bookingOrder.id}`,
              cancelUrl: `${siteUrl}/quote/${quote.quoteId}/booking`,
              idempotencyKey,
            })
          : createPrepaidCardCheckoutSession(stripe, {
              stripeCustomerId,
              bookingOrderId: bookingOrder.id,
              packageSubtotal: chargedSubtotal,
              productName,
              successUrl: `${siteUrl}/booking/${bookingOrder.id}`,
              cancelUrl: `${siteUrl}/quote/${quote.quoteId}/booking`,
              idempotencyKey,
            }),
    });

    await repo.updateBookingOrderStatus(bookingOrder.id, "draft", "awaiting_payment");
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
