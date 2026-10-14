"use server";

import { redirect } from "next/navigation";
import { getNotificationRecipientContact } from "@/lib/notifications/customer-contact-lookup";
import { createResendNotificationEmailSender } from "@/lib/notifications/resend-notification-email-sender";
import { createSupabaseSchedulingRepository } from "@/lib/scheduling/supabase-scheduling-repository";
import { createSupabaseCustomerAuthLinkGenerator } from "../customer-auth-link";
import { requestFreshPaymentLink } from "../request-fresh-payment-link";

const VISIT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Backs the unauthenticated /my/payment-link-expired page's form. Reads
 * `visit` straight from the submitted form, never a session (there is no
 * session) — only ever acts as a mailer trigger keyed to a visit id, never
 * returns or exposes any visit data itself. Collapses every distinct
 * requestFreshPaymentLink() failure reason down to a single generic
 * "error" redirect state, so this endpoint can never be used to probe
 * which visit ids exist, are payable, or have an email on file.
 */
export async function requestFreshPaymentLinkFormAction(formData: FormData): Promise<void> {
  const raw = formData.get("visit");
  const visitId = typeof raw === "string" ? raw.trim() : "";

  if (!VISIT_ID_PATTERN.test(visitId)) {
    redirect("/my/payment-link-expired?error=1");
  }

  const result = await requestFreshPaymentLink(
    {
      repo: createSupabaseSchedulingRepository(),
      contactLookup: getNotificationRecipientContact,
      authLinkGenerator: createSupabaseCustomerAuthLinkGenerator(),
      emailSender: createResendNotificationEmailSender(),
    },
    visitId
  );

  redirect(`/my/payment-link-expired?visit=${encodeURIComponent(visitId)}${result.ok ? "&sent=1" : "&error=1"}`);
}
