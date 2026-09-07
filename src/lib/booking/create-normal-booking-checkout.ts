"use server";

import { redirect } from "next/navigation";
import { checkFirstCleaningEligibility } from "@/lib/instant-quote/first-cleaning-eligibility";
import { calculateEstimate } from "@/lib/pricing/calculate-estimate";
import type { FrequencyId } from "@/lib/pricing/types";
import { SITE_CONTACT } from "@/lib/site-contact";
import { CANCELLATION_POLICY_VERSION } from "./cancellation-policy";
import { getOrCreateCheckoutSessionUrl } from "./create-checkout-attempt";
import { getQuoteForBooking } from "./get-quote-for-booking";
import { isWithinOperatingHours } from "./operating-hours";
import { getSiteUrl } from "./site-url";
import { createSetupCheckoutSession } from "./stripe/checkout-sessions";
import { getStripeClient } from "./stripe/client";
import { resolveStripeCustomerId } from "./stripe/customers";
import { createSupabaseBookingRepository } from "./supabase-booking-repository";
import type { NormalBookingSelectionInput, NotBookableReason } from "./types";
import {
  validateAddOnIds,
  validateMovePackageLevel,
  validateOutdoorSelection,
  validateQuantifiedAddOns,
  validateSpecialRooms,
} from "./validate-customization-selection";

const NORMAL_FREQUENCIES: FrequencyId[] = ["one_time", "weekly", "biweekly", "every_4_weeks"];
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const GENERIC_ERROR_MESSAGE = `We couldn't start your booking right now. Please try again or contact CleanPerfecto at ${SITE_CONTACT.phoneDisplay}.`;

export type CreateNormalBookingCheckoutResult =
  | { ok: false; stage: "validation"; errors: string[] }
  | { ok: false; stage: "not_bookable"; reason: NotBookableReason }
  | { ok: false; stage: "failed"; message: string };
// ok:true is never returned — success ends in redirect(), which throws
// internally and is handled by the framework, not returned to the caller.

function validate(raw: NormalBookingSelectionInput): string[] {
  const errors: string[] = [];
  if (!raw.clientRequestId) errors.push("Missing request id.");
  if (!NORMAL_FREQUENCIES.includes(raw.frequency)) errors.push("Please choose a valid cleaning frequency.");
  if (!DATE_PATTERN.test(raw.requestedDate)) errors.push("Please choose a preferred date.");
  if (!isWithinOperatingHours(raw.requestedStartTime)) {
    errors.push("Please choose a preferred start time between 8:00 AM and 6:00 PM.");
  }
  if (!raw.paymentMethodSaveAuthorized) {
    errors.push(
      "Please authorize CleanPerfecto to securely save your payment method and accept the cancellation/rescheduling policy to continue."
    );
  }
  return errors;
}

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
  const errors = validate(raw);
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
  } catch {
    return { ok: false, stage: "failed", message: GENERIC_ERROR_MESSAGE };
  }

  redirect(sessionUrl);
}
