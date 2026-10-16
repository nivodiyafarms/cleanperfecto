"use server";

import { redirect } from "next/navigation";
import { requireCustomer } from "@/lib/customer-portal/require-customer";
import { createSupabaseCustomerAuthLinkGenerator } from "@/lib/customer-portal/customer-auth-link";
import { createAgreedQuoteBookingCheckout } from "@/lib/booking/create-agreed-quote-booking-checkout";
import { createSupabaseAgreedQuoteInvitationRepository } from "@/lib/instant-quote/supabase-agreed-quote-invitation-repository";
import { sendAgreedQuoteInvitation } from "@/lib/instant-quote/send-agreed-quote-invitation";
import { createResendNotificationEmailSender } from "@/lib/notifications/resend-notification-email-sender";
import type { PaymentMethodType } from "@/lib/booking/types";

export interface AcceptAgreedQuoteActionResult {
  ok: false;
  message: string;
}
// ok:true is never returned — success ends in redirect() to Stripe Checkout.

/**
 * The only client-facing wrapper around createAgreedQuoteBookingCheckout —
 * that orchestrator takes an injected repository (not serializable across
 * the Server Action boundary), so the Client Component
 * (AgreedQuoteAcceptanceClient.tsx) calls THIS function instead, which
 * constructs the real repository server-side and authenticates the caller
 * via requireCustomer() — customerId is never trusted from the client.
 */
export async function acceptAgreedQuoteAction(_prevState: AcceptAgreedQuoteActionResult | null, formData: FormData): Promise<AcceptAgreedQuoteActionResult> {
  const customer = await requireCustomer();
  const invitationId = String(formData.get("invitationId") ?? "");
  const consentAccepted = formData.get("consentAccepted") === "on" || formData.get("consentAccepted") === "true";
  const presentedConsentVersionId = String(formData.get("presentedConsentVersionId") ?? "");
  const requestedDate = formData.get("requestedDate") ? String(formData.get("requestedDate")) : undefined;
  const requestedStartTime = formData.get("requestedStartTime") ? String(formData.get("requestedStartTime")) : undefined;
  const paymentMethod = formData.get("paymentMethod") ? (String(formData.get("paymentMethod")) as PaymentMethodType) : undefined;

  if (!invitationId) {
    return { ok: false, message: "Missing invitation." };
  }

  const invitationRepo = createSupabaseAgreedQuoteInvitationRepository();
  const result = await createAgreedQuoteBookingCheckout(invitationRepo, {
    invitationId,
    customerId: customer.customerId,
    consentAccepted,
    presentedConsentVersionId,
    requestedDate,
    requestedStartTime,
    paymentMethod,
  });

  if (result.stage === "claim_failed") {
    const CLAIM_FAILURE_MESSAGE: Record<typeof result.reason, string> = {
      not_found: "This offer is no longer available.",
      wrong_customer: "This offer is no longer available.",
      expired: "This offer has expired.",
      cancelled: "This offer is no longer available.",
      superseded: "This offer has been replaced by a newer one.",
      completed: "You're already enrolled.",
      unknown: "This offer is no longer available.",
    };
    return { ok: false, message: CLAIM_FAILURE_MESSAGE[result.reason] };
  }
  if (result.stage === "validation") {
    return { ok: false, message: result.errors.join(" ") };
  }
  if (result.stage === "consent_changed") {
    return { ok: false, message: "Our Service Terms were just updated — please review the page again before continuing." };
  }
  if (result.stage === "not_bookable") {
    return { ok: false, message: "This offer can no longer be processed automatically — please contact CleanPerfecto." };
  }
  return { ok: false, message: result.message };
}

export interface RequestFreshAgreedQuoteLinkResult {
  ok: boolean;
}

/**
 * The unauthenticated expired-link recovery action — resends via the SAME
 * sendAgreedQuoteInvitation primitive as the admin's Resend, never
 * extending expires_at. Collapses every failure reason to a generic
 * outcome (never discloses which invitation ids exist, or their state, to
 * an unauthenticated caller) — same posture as requestFreshPaymentLink's
 * public caller.
 */
const INVITATION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function requestFreshAgreedQuoteLinkFormAction(formData: FormData): Promise<void> {
  const raw = formData.get("invitationId");
  const invitationId = typeof raw === "string" ? raw.trim() : "";

  if (!INVITATION_ID_PATTERN.test(invitationId)) {
    redirect("/my/agreed-quote-link-expired?error=1");
  }

  const result = await sendAgreedQuoteInvitation(
    {
      invitationRepo: createSupabaseAgreedQuoteInvitationRepository(),
      authLinkGenerator: createSupabaseCustomerAuthLinkGenerator(),
      emailSender: createResendNotificationEmailSender(),
    },
    invitationId
  );

  redirect(`/my/agreed-quote-link-expired?invitation=${encodeURIComponent(invitationId)}${result.ok ? "&sent=1" : "&error=1"}`);
}
