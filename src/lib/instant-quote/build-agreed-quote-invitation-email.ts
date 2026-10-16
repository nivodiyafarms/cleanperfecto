import { SITE_CONTACT } from "@/lib/site-contact";

export interface AgreedQuoteInvitationEmailInput {
  customerName: string;
  /** Formatted for display, e.g. "$312.50" or "$600.00 for 6 visits". */
  agreedPriceLabel: string;
  authenticatedLink: string;
}

export interface AgreedQuoteInvitationEmailContent {
  subject: string;
  text: string;
  html: string;
}

/**
 * Self-contained builder, deliberately NOT a new case added to the shared
 * buildNotificationContent (src/lib/notifications/notification-content.ts)
 * — that function is scoped to service_visit-keyed notification types, and
 * an agreed-quote invitation isn't one. Mirrors its plain inline-styled
 * html shape without importing it.
 */
export function buildAgreedQuoteInvitationEmail(input: AgreedQuoteInvitationEmailInput): AgreedQuoteInvitationEmailContent {
  const subject = "Your CleanPerfecto cleaning offer is ready to review";
  const text = `Hi ${input.customerName},\n\nCleanPerfecto has prepared your agreed cleaning offer (${input.agreedPriceLabel}). Review and accept it here:\n${input.authenticatedLink}\n\nIf you have any questions, contact us at ${SITE_CONTACT.phoneDisplay} or ${SITE_CONTACT.email}.\n\n— CleanPerfecto`;
  const html = `
    <div style="font-family: -apple-system, Helvetica, Arial, sans-serif; color: #17233C; max-width: 480px; margin: 0 auto;">
      <p>Hi ${input.customerName},</p>
      <p>CleanPerfecto has prepared your agreed cleaning offer: <strong>${input.agreedPriceLabel}</strong>.</p>
      <p>
        <a href="${input.authenticatedLink}" style="display: inline-block; background: #58C7C9; color: #ffffff; padding: 12px 20px; border-radius: 8px; text-decoration: none; font-weight: 600;">
          Review &amp; Accept Your Offer
        </a>
      </p>
      <p style="color: #66758A; font-size: 13px;">If you have any questions, contact us at ${SITE_CONTACT.phoneDisplay} or <a href="${SITE_CONTACT.emailHref}">${SITE_CONTACT.email}</a>.</p>
      <p>— CleanPerfecto</p>
    </div>
  `.trim();

  return { subject, text, html };
}
