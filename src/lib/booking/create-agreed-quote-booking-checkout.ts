"use server";

import { redirect } from "next/navigation";
import type { AgreedQuoteInvitationRepository } from "@/lib/instant-quote/agreed-quote-invitation-repository";
import { assertCanCreateStripeCharge, assertCanCreateStripeSetup } from "@/lib/config/payment-capabilities";
import { RuntimeConfigurationError } from "@/lib/config/runtime-env";
import { SITE_CONTACT } from "@/lib/site-contact";
import { acceptConsentClickwrap } from "@/lib/consent/accept-consent-clickwrap";
import { captureAuditHeaders } from "@/lib/consent/capture-audit-headers";
import { createSupabaseConsentRepository } from "@/lib/consent/consent-repository";
import { ConsentVersionChangedError, InvalidConsentStateError } from "@/lib/consent/errors";
import { createSupabaseSchedulingRepository } from "@/lib/scheduling/supabase-scheduling-repository";
import { applyAchIncentive } from "./ach-incentive";
import { CANCELLATION_POLICY_VERSION, PREPAID_PAYMENT_AUTHORIZATION_COPY, SAVED_PAYMENT_AUTHORIZATION_COPY, formatCancellationPolicySnapshot } from "./cancellation-policy";
import { getOrCreateCheckoutSessionUrl } from "./create-checkout-attempt";
import { getQuoteForBooking } from "./get-quote-for-booking";
import { PREPAID_FREQUENCY_LABELS } from "./labels";
import { isWithinOperatingHours } from "./operating-hours";
import { getSiteUrl } from "./site-url";
import { createPrepaidAchCheckoutSession, createPrepaidCardCheckoutSession, createSetupCheckoutSession } from "./stripe/checkout-sessions";
import { getStripeClient } from "./stripe/client";
import { resolveStripeCustomerId } from "./stripe/customers";
import { createSupabaseBookingRepository } from "./supabase-booking-repository";
import type { ConsentVersionSummary, NotBookableReason, PaymentMethodType, PrepaidFrequency } from "./types";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const PREPAID_VISIT_COUNT = 6;

const GENERIC_ERROR_MESSAGE = `We couldn't complete your enrollment right now. Please try again or contact CleanPerfecto at ${SITE_CONTACT.phoneDisplay}.`;
const PAYMENT_TEMPORARILY_UNAVAILABLE_MESSAGE = `Online enrollment is temporarily unavailable. Please contact CleanPerfecto at ${SITE_CONTACT.phoneDisplay} to schedule.`;

export interface AgreedQuoteAcceptanceInput {
  invitationId: string;
  /** The AUTHENTICATED customer's id (requireCustomer()), never a client-supplied value — the atomic claim's ownership check depends on this being trustworthy. */
  customerId: string;
  consentAccepted: boolean;
  presentedConsentVersionId: string;
  /** Required only when the invitation's booking is normal/Pay-Per-Cleaning AND the admin didn't pre-set an agreed date/time. */
  requestedDate?: string;
  requestedStartTime?: string;
  /** Required only when the invitation's booking is a prepaid package. */
  paymentMethod?: PaymentMethodType;
}

export type AgreedQuoteClaimFailureReason = "not_found" | "wrong_customer" | "expired" | "cancelled" | "superseded" | "completed" | "unknown";

export type CreateAgreedQuoteBookingCheckoutResult =
  | { ok: false; stage: "claim_failed"; reason: AgreedQuoteClaimFailureReason }
  | { ok: false; stage: "not_bookable"; reason: NotBookableReason }
  | { ok: false; stage: "validation"; errors: string[] }
  | { ok: false; stage: "consent_changed"; currentVersion: ConsentVersionSummary }
  | { ok: false; stage: "failed"; message: string };
// ok:true is never returned — success ends in redirect(), same convention as createNormalBookingCheckout/createPrepaidPackageCheckout.

async function resolveClaimFailureReason(invitationRepo: AgreedQuoteInvitationRepository, invitationId: string, customerId: string, now: Date): Promise<AgreedQuoteClaimFailureReason> {
  const invitation = await invitationRepo.findAgreedQuoteInvitationById(invitationId);
  if (!invitation || invitation.customerId !== customerId) return "not_found"; // collapsed with wrong_customer — never discloses which case it was
  if (invitation.status === "completed") return "completed";
  if (invitation.status === "cancelled") return "cancelled";
  if (invitation.status === "superseded") return "superseded";
  if (new Date(invitation.expiresAt).getTime() <= now.getTime()) return "expired";
  return "unknown";
}

/**
 * Customer-side acceptance orchestrator — parallel to, never calling,
 * createNormalBookingCheckout/createPrepaidPackageCheckout. The admin's
 * agreed price is taken verbatim from the quote's frozen pricingSnapshotResult
 * — calculateEstimate is never called here. See the approved plan's §2/§3/§6
 * for the full claim/race-safety rationale; this function implements that
 * design exactly, including the booking_order_id link-and-recheck
 * immediately before any Stripe call.
 */
export async function createAgreedQuoteBookingCheckout(
  invitationRepo: AgreedQuoteInvitationRepository,
  input: AgreedQuoteAcceptanceInput
): Promise<CreateAgreedQuoteBookingCheckoutResult> {
  if (!input.consentAccepted || !input.presentedConsentVersionId) {
    return {
      ok: false,
      stage: "validation",
      errors: ["Please agree to CleanPerfecto's Service Terms, Cancellation & Rescheduling Policy, and Payment Authorization to continue."],
    };
  }

  const now = new Date();

  // §3: ownership, status, and the resume-vs-new-session expiry rule are
  // all inside this one atomic claim — checked before constructing any
  // other dependency, so a refused claim never touches Stripe/Supabase
  // booking state at all.
  const claimed = await invitationRepo.claimAgreedQuoteInvitationCheckout(input.invitationId, input.customerId, now);
  if (!claimed) {
    const reason = await resolveClaimFailureReason(invitationRepo, input.invitationId, input.customerId, now);
    return { ok: false, stage: "claim_failed", reason };
  }

  const bookingRepo = createSupabaseBookingRepository();
  const quoteResult = await getQuoteForBooking(claimed.quoteRequestId, bookingRepo);
  if (!quoteResult.ok) {
    return { ok: false, stage: "not_bookable", reason: quoteResult.reason };
  }
  const quote = quoteResult.quote;
  // No calculateEstimate call — the agreed price is taken verbatim.
  const calculationInput = quote.baseInput;
  const result = quote.pricingSnapshotResult;
  const isPrepaidPackage = calculationInput.isPrepaidPackage;

  let requestedDate: string | null = claimed.agreedRequestedDate;
  let requestedStartTime: string | null = claimed.agreedRequestedStartTime;
  if (!isPrepaidPackage && !requestedDate) {
    if (!input.requestedDate || !DATE_PATTERN.test(input.requestedDate)) {
      return { ok: false, stage: "validation", errors: ["Please choose a preferred date."] };
    }
    if (!input.requestedStartTime || !isWithinOperatingHours(input.requestedStartTime)) {
      return { ok: false, stage: "validation", errors: ["Please choose a preferred start time between 8:00 AM and 5:00 PM."] };
    }
    requestedDate = input.requestedDate;
    requestedStartTime = input.requestedStartTime;
  }
  if (isPrepaidPackage && !input.paymentMethod) {
    return { ok: false, stage: "validation", errors: ["Please choose a payment method."] };
  }

  let sessionUrl: string;
  try {
    if (isPrepaidPackage) {
      assertCanCreateStripeCharge();
    } else {
      assertCanCreateStripeSetup();
    }

    const { ipAddress, userAgent } = await captureAuditHeaders();
    const consentAcceptance = await acceptConsentClickwrap(createSupabaseConsentRepository(), createSupabaseSchedulingRepository(), {
      customerId: quote.customerId,
      presentedConsentVersionId: input.presentedConsentVersionId,
      ipAddress,
      userAgent,
    });

    const bookingOrder = await bookingRepo.insertBookingOrder({
      customerId: quote.customerId,
      quoteRequestId: quote.quoteId,
      clientRequestId: claimed.clientRequestId,
      bookingType: isPrepaidPackage ? "prepaid_package" : "normal",
      cleaningType: quote.cleaningType,
      frequency: calculationInput.frequency,
      visitCount: isPrepaidPackage ? PREPAID_VISIT_COUNT : 1,
      paymentAuthorizationAcceptedAt: now.toISOString(),
      // Verbatim from the frozen agreed-quote snapshot — never recomputed.
      pricingVersion: result.pricingVersion,
      pricingSnapshot: { input: calculationInput, result },
      calculatedTotal: result.calculatedTotal,
      displayRangeLower: result.range?.lower ?? null,
      displayRangeUpper: result.range?.upper ?? null,
      prepaidPackageTotal: result.prepaidPackageTotal,
      effectivePricePerVisit: result.effectivePricePerVisit,
      hasStartingAtPricing: result.hasStartingAtPricing,
      manualReviewReasons: result.manualReviewReasons,
      selectedAddOnIds: calculationInput.addOnIds,
      serviceAddressLine1: quote.serviceAddressLine1,
      serviceAddressLine2: quote.serviceAddressLine2,
      serviceCity: quote.serviceCity,
      serviceState: quote.serviceState,
      serviceAddressIdentity: quote.serviceAddressIdentity,
      requestedDate: isPrepaidPackage ? null : requestedDate,
      requestedTimeWindow: null,
      requestedStartTime: isPrepaidPackage ? null : requestedStartTime,
      cancellationPolicyVersion: CANCELLATION_POLICY_VERSION,
      paymentAuthorizationTextSnapshot: isPrepaidPackage ? PREPAID_PAYMENT_AUTHORIZATION_COPY : SAVED_PAYMENT_AUTHORIZATION_COPY,
      consentVersionId: consentAcceptance.consentVersionId,
      cancellationPolicyTextSnapshot: formatCancellationPolicySnapshot(isPrepaidPackage),
    });

    // §3 step 6: link, and re-confirm status is still 'checkout_in_progress'
    // — null means an admin's Cancel won the race since step 1's claim.
    // Never call Stripe in that case; the booking order above is orphaned
    // but harmless (no invitation points at it, so no later webhook lookup
    // can find it).
    const linked = await invitationRepo.linkAgreedQuoteInvitationBookingOrder(input.invitationId, bookingOrder.id);
    if (!linked) {
      return { ok: false, stage: "failed", message: "This offer was just cancelled. Please contact CleanPerfecto for help." };
    }

    const stripe = getStripeClient();
    const stripeCustomerId = await resolveStripeCustomerId(
      stripe,
      quote.customerId,
      { line1: quote.serviceAddressLine1, line2: quote.serviceAddressLine2, city: quote.serviceCity, state: quote.serviceState, zip: calculationInput.zip },
      bookingRepo
    );

    const siteUrl = getSiteUrl();
    if (isPrepaidPackage) {
      const cardSubtotal = result.prepaidPackageTotal ?? result.calculatedTotal;
      const isAch = input.paymentMethod === "us_bank_account";
      const achIncentive = isAch ? applyAchIncentive(cardSubtotal) : null;
      const chargedSubtotal = achIncentive ? achIncentive.achSubtotal : cardSubtotal;
      const productName = `${PREPAID_FREQUENCY_LABELS[calculationInput.frequency as PrepaidFrequency]} 6-Cleaning Prepaid Package`;

      sessionUrl = await getOrCreateCheckoutSessionUrl({
        repo: bookingRepo,
        stripe,
        bookingOrderId: bookingOrder.id,
        mode: "payment",
        stripeCustomerId,
        amount: chargedSubtotal,
        paymentMethodType: input.paymentMethod,
        packageSubtotalBeforeAchIncentive: achIncentive ? cardSubtotal : null,
        achSavingsAmount: achIncentive ? achIncentive.achSavingsAmount : null,
        createSession: (idempotencyKey) =>
          isAch
            ? createPrepaidAchCheckoutSession(stripe, { stripeCustomerId, bookingOrderId: bookingOrder.id, packageSubtotal: chargedSubtotal, productName, successUrl: `${siteUrl}/booking/${bookingOrder.id}`, cancelUrl: `${siteUrl}/my/agreed-quote/${input.invitationId}`, idempotencyKey })
            : createPrepaidCardCheckoutSession(stripe, { stripeCustomerId, bookingOrderId: bookingOrder.id, packageSubtotal: chargedSubtotal, productName, successUrl: `${siteUrl}/booking/${bookingOrder.id}`, cancelUrl: `${siteUrl}/my/agreed-quote/${input.invitationId}`, idempotencyKey }),
      });

      await bookingRepo.updateBookingOrderStatus(bookingOrder.id, "draft", "awaiting_payment");
    } else {
      sessionUrl = await getOrCreateCheckoutSessionUrl({
        repo: bookingRepo,
        stripe,
        bookingOrderId: bookingOrder.id,
        mode: "setup",
        stripeCustomerId,
        amount: null,
        createSession: (idempotencyKey) =>
          createSetupCheckoutSession(stripe, { stripeCustomerId, bookingOrderId: bookingOrder.id, successUrl: `${siteUrl}/booking/${bookingOrder.id}`, cancelUrl: `${siteUrl}/my/agreed-quote/${input.invitationId}`, idempotencyKey }),
      });

      await bookingRepo.updateBookingOrderStatus(bookingOrder.id, "draft", "awaiting_payment_method");
    }
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
