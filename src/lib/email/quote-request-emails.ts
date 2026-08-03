import "server-only";

import { createResendClient } from "@/lib/email/resend";
import { parseQuoteNotificationRecipients } from "@/lib/email/quote-notification-recipients";
import { getQuotePropertyTypeLabel, getQuoteServiceLabel } from "@/lib/quote/labels";
import { SITE_CONTACT } from "@/lib/site-contact";

export type QuoteRequestEmailDetails = {
  id: string;
  createdAt: string;
  name: string;
  phone: string;
  email: string;
  zip: string;
  propertyType: string;
  serviceId: string;
  preferredDate: string | null;
  message: string | null;
};

const ADMIN_FROM_ADDRESS = "CleanPerfecto Quotes <notifications@cleanperfecto.com>";
const CUSTOMER_FROM_ADDRESS = "CleanPerfecto <support@cleanperfecto.com>";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatSubmittedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return `${date.toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Chicago",
  })} (Central Time)`;
}

// ---------------------------------------------------------------------------
// Admin notification — Phase 1 (active)
// ---------------------------------------------------------------------------

function buildAdminNotificationEmail(details: QuoteRequestEmailDetails) {
  const propertyLabel = getQuotePropertyTypeLabel(details.propertyType);
  const serviceLabel = getQuoteServiceLabel(details.serviceId);
  const submittedAt = formatSubmittedAt(details.createdAt);
  const preferredDateText = details.preferredDate ?? "Not provided";
  const messageText = details.message ?? "Not provided";

  const subject = `New CleanPerfecto Quote Request — ${propertyLabel} — ${details.zip}`;

  const text = [
    subject,
    "",
    `Quote request ID: ${details.id}`,
    `Submitted: ${submittedAt}`,
    "",
    `Name: ${details.name}`,
    `Phone: ${details.phone}`,
    `Email: ${details.email}`,
    `ZIP code: ${details.zip}`,
    `Property type: ${propertyLabel}`,
    `Service type: ${serviceLabel}`,
    `Preferred date: ${preferredDateText}`,
    `Message: ${messageText}`,
    "",
    "The complete inquiry remains saved in Supabase.",
  ].join("\n");

  const html = [
    `<h2>${escapeHtml(subject)}</h2>`,
    `<p><strong>Quote request ID:</strong> ${escapeHtml(details.id)}<br/>`,
    `<strong>Submitted:</strong> ${escapeHtml(submittedAt)}</p>`,
    "<ul>",
    `<li><strong>Name:</strong> ${escapeHtml(details.name)}</li>`,
    `<li><strong>Phone:</strong> ${escapeHtml(details.phone)}</li>`,
    `<li><strong>Email:</strong> ${escapeHtml(details.email)}</li>`,
    `<li><strong>ZIP code:</strong> ${escapeHtml(details.zip)}</li>`,
    `<li><strong>Property type:</strong> ${escapeHtml(propertyLabel)}</li>`,
    `<li><strong>Service type:</strong> ${escapeHtml(serviceLabel)}</li>`,
    `<li><strong>Preferred date:</strong> ${escapeHtml(preferredDateText)}</li>`,
    `<li><strong>Message:</strong> ${escapeHtml(messageText)}</li>`,
    "</ul>",
    "<p>The complete inquiry remains saved in Supabase.</p>",
  ].join("");

  return { subject, text, html };
}

export type AdminNotificationDeliveryResult = {
  recipient: string;
  sent: boolean;
};

export type AdminNotificationSummary = {
  /** False when QUOTE_NOTIFICATION_EMAILS had no valid recipients configured. */
  configured: boolean;
  attempted: number;
  sent: number;
  results: AdminNotificationDeliveryResult[];
};

/**
 * Sends one independent email per configured admin recipient so a single bad
 * address can't block delivery to the others, and recipients are never
 * exposed to each other. Never throws — every failure mode (missing config,
 * missing RESEND_API_KEY, a rejected send) resolves to a summary so callers
 * can log without risking the caller's own success path.
 */
export async function sendAdminQuoteRequestNotification(
  details: QuoteRequestEmailDetails
): Promise<AdminNotificationSummary> {
  const recipients = parseQuoteNotificationRecipients(process.env.QUOTE_NOTIFICATION_EMAILS);

  if (recipients.length === 0) {
    console.warn(
      `[quote-notification] no valid QUOTE_NOTIFICATION_EMAILS recipients configured; quoteId=${details.id}`
    );
    return { configured: false, attempted: 0, sent: 0, results: [] };
  }

  let resend: ReturnType<typeof createResendClient>;
  try {
    resend = createResendClient();
  } catch {
    console.error(
      `[quote-notification] resend client unavailable (missing RESEND_API_KEY?); quoteId=${details.id}`
    );
    return {
      configured: true,
      attempted: recipients.length,
      sent: 0,
      results: recipients.map((recipient) => ({ recipient, sent: false })),
    };
  }

  const { subject, text, html } = buildAdminNotificationEmail(details);

  const settled = await Promise.allSettled(
    recipients.map((to) =>
      resend.emails.send({
        from: ADMIN_FROM_ADDRESS,
        to,
        subject,
        text,
        html,
        replyTo: SITE_CONTACT.email,
      })
    )
  );

  const results = settled.map((outcome, index) => {
    const recipient = recipients[index];
    const sent = outcome.status === "fulfilled" && !outcome.value.error;

    if (!sent) {
      const category = outcome.status === "rejected" ? "send_rejected" : "provider_error";
      // Resend's own error name/message are operational strings (e.g. domain
      // verification, rate limiting) — safe to log, never customer content.
      const detail =
        outcome.status === "rejected"
          ? outcome.reason instanceof Error
            ? outcome.reason.message
            : "unknown"
          : `${outcome.value.error?.name ?? "unknown"}: ${outcome.value.error?.message ?? "unknown"}`;
      console.error(
        `[quote-notification] admin notify failed; quoteId=${details.id} category=${category} detail=${detail}`
      );
    }

    return { recipient, sent };
  });

  return {
    configured: true,
    attempted: recipients.length,
    sent: results.filter((result) => result.sent).length,
    results,
  };
}

// ---------------------------------------------------------------------------
// Customer confirmation email — active.
// ---------------------------------------------------------------------------

function buildCustomerAcknowledgementEmail(details: QuoteRequestEmailDetails) {
  const propertyLabel = getQuotePropertyTypeLabel(details.propertyType);
  const serviceLabel = getQuoteServiceLabel(details.serviceId);

  const subject = "We received your CleanPerfecto quote request";

  const text = [
    `Hi ${details.name},`,
    "",
    "Thank you for contacting CleanPerfecto. We received your cleaning request successfully.",
    "",
    `Request reference: ${details.id}`,
    `Property type: ${propertyLabel}`,
    `Cleaning service: ${serviceLabel}`,
    ...(details.preferredDate ? [`Preferred date: ${details.preferredDate}`] : []),
    "",
    "Our team will review your request and contact you regarding availability and pricing.",
    "",
    `For immediate assistance, call or text ${SITE_CONTACT.phoneDisplay}.`,
    "",
    "CleanPerfecto",
    "Where Clean Meets Perfection",
    "",
    `This is an automated confirmation. For assistance, reply to this email or call/text ${SITE_CONTACT.phoneDisplay}.`,
  ].join("\n");

  const html = [
    `<p>Hi ${escapeHtml(details.name)},</p>`,
    "<p>Thank you for contacting CleanPerfecto. We received your cleaning request successfully.</p>",
    "<ul>",
    `<li><strong>Request reference:</strong> ${escapeHtml(details.id)}</li>`,
    `<li><strong>Property type:</strong> ${escapeHtml(propertyLabel)}</li>`,
    `<li><strong>Cleaning service:</strong> ${escapeHtml(serviceLabel)}</li>`,
    ...(details.preferredDate
      ? [`<li><strong>Preferred date:</strong> ${escapeHtml(details.preferredDate)}</li>`]
      : []),
    "</ul>",
    "<p>Our team will review your request and contact you regarding availability and pricing.</p>",
    `<p>For immediate assistance, call or text ${escapeHtml(SITE_CONTACT.phoneDisplay)}.</p>`,
    "<p>CleanPerfecto<br/>Where Clean Meets Perfection</p>",
    `<p>This is an automated confirmation. For assistance, reply to this email or call/text ${escapeHtml(SITE_CONTACT.phoneDisplay)}.</p>`,
  ].join("");

  return { subject, text, html };
}

export type CustomerEmailFailureCategory = "client_unavailable" | "provider_error" | "send_rejected";

export type CustomerEmailResult = {
  sent: boolean;
  failureCategory?: CustomerEmailFailureCategory;
};

/**
 * Sends the customer confirmation email. Never throws — every failure mode
 * (missing RESEND_API_KEY, a provider error, an unexpected rejection)
 * resolves to a result so callers can log without risking their own
 * success path.
 */
export async function sendCustomerQuoteRequestEmail(
  details: QuoteRequestEmailDetails
): Promise<CustomerEmailResult> {
  let resend: ReturnType<typeof createResendClient>;
  try {
    resend = createResendClient();
  } catch {
    console.error(
      `[quote-customer-email] resend client unavailable; quoteId=${details.id} category=client_unavailable`
    );
    return { sent: false, failureCategory: "client_unavailable" };
  }

  const { subject, text, html } = buildCustomerAcknowledgementEmail(details);

  try {
    const result = await resend.emails.send({
      from: CUSTOMER_FROM_ADDRESS,
      to: details.email,
      subject,
      text,
      html,
      replyTo: SITE_CONTACT.email,
    });

    if (result.error) {
      // Resend's own error name/message are operational strings (e.g.
      // domain verification, rate limiting) — safe to log, never customer
      // content, and the recipient address is never included.
      console.error(
        `[quote-customer-email] send failed; quoteId=${details.id} category=provider_error detail=${result.error.name ?? "unknown"}: ${result.error.message ?? "unknown"}`
      );
      return { sent: false, failureCategory: "provider_error" };
    }

    return { sent: true };
  } catch (err) {
    console.error(
      `[quote-customer-email] send threw unexpectedly; quoteId=${details.id} category=send_rejected detail=${err instanceof Error ? err.message : "unknown"}`
    );
    return { sent: false, failureCategory: "send_rejected" };
  }
}
