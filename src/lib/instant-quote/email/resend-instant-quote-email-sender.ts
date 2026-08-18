import "server-only";

import { createResendClient } from "@/lib/email/resend";
import { parseQuoteNotificationRecipients } from "@/lib/email/quote-notification-recipients";
import { SITE_CONTACT } from "@/lib/site-contact";
import { buildInstantQuoteAdminEmail } from "./build-admin-email";
import { buildInstantQuoteCustomerEmail } from "./build-customer-email";
import type { InstantQuoteEmailDetails } from "./build-email-details";
import type {
  InstantQuoteAdminNotificationSummary,
  InstantQuoteCustomerEmailResult,
  InstantQuoteEmailSender,
} from "./sender";

const ADMIN_FROM_ADDRESS = "CleanPerfecto Quotes <notifications@cleanperfecto.com>";
const CUSTOMER_FROM_ADDRESS = "CleanPerfecto <support@cleanperfecto.com>";

/**
 * Production Resend-backed InstantQuoteEmailSender. Mirrors
 * src/lib/email/quote-request-emails.ts's established patterns (per-
 * recipient fan-out for admin notifications so one bad address can't block
 * the others; never throws — every failure mode resolves to a typed
 * summary) applied to the new instant-quote email content. Deliberately a
 * separate, additive module rather than a refactor of the legacy file.
 */
export function createResendInstantQuoteEmailSender(): InstantQuoteEmailSender {
  return {
    async sendAdminNotification(details: InstantQuoteEmailDetails): Promise<InstantQuoteAdminNotificationSummary> {
      const recipients = parseQuoteNotificationRecipients(process.env.QUOTE_NOTIFICATION_EMAILS);

      if (recipients.length === 0) {
        console.warn(
          `[instant-quote-email] no valid QUOTE_NOTIFICATION_EMAILS recipients configured; quoteId=${details.quoteId}`
        );
        return { configured: false, attempted: 0, sent: 0 };
      }

      let resend: ReturnType<typeof createResendClient>;
      try {
        resend = createResendClient();
      } catch {
        console.error(
          `[instant-quote-email] resend client unavailable (missing RESEND_API_KEY?); quoteId=${details.quoteId}`
        );
        return { configured: true, attempted: recipients.length, sent: 0 };
      }

      const { subject, text, html } = buildInstantQuoteAdminEmail(details);

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

      let sent = 0;
      settled.forEach((outcome, index) => {
        const isSent = outcome.status === "fulfilled" && !outcome.value.error;
        if (isSent) {
          sent += 1;
          return;
        }
        const category = outcome.status === "rejected" ? "send_rejected" : "provider_error";
        const detail =
          outcome.status === "rejected"
            ? outcome.reason instanceof Error
              ? outcome.reason.message
              : "unknown"
            : `${outcome.value.error?.name ?? "unknown"}: ${outcome.value.error?.message ?? "unknown"}`;
        console.error(
          `[instant-quote-email] admin notify failed; quoteId=${details.quoteId} recipientIndex=${index} category=${category} detail=${detail}`
        );
      });

      return { configured: true, attempted: recipients.length, sent };
    },

    async sendCustomerConfirmation(details: InstantQuoteEmailDetails): Promise<InstantQuoteCustomerEmailResult> {
      if (!details.email) {
        return { attempted: false, sent: false };
      }

      let resend: ReturnType<typeof createResendClient>;
      try {
        resend = createResendClient();
      } catch {
        console.error(
          `[instant-quote-email] resend client unavailable for customer email; quoteId=${details.quoteId}`
        );
        return { attempted: true, sent: false };
      }

      const { subject, text, html } = buildInstantQuoteCustomerEmail(details);

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
          console.error(
            `[instant-quote-email] customer email failed; quoteId=${details.quoteId} detail=${result.error.name ?? "unknown"}: ${result.error.message ?? "unknown"}`
          );
          return { attempted: true, sent: false };
        }

        return { attempted: true, sent: true };
      } catch (err) {
        console.error(
          `[instant-quote-email] customer email threw unexpectedly; quoteId=${details.quoteId} detail=${err instanceof Error ? err.message : "unknown"}`
        );
        return { attempted: true, sent: false };
      }
    },
  };
}
