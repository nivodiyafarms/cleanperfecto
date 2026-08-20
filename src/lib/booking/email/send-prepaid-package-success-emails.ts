import "server-only";

import { createResendClient } from "@/lib/email/resend";
import { parseQuoteNotificationRecipients } from "@/lib/email/quote-notification-recipients";
import { SITE_CONTACT } from "@/lib/site-contact";
import { loadBookingEmailDetails } from "./booking-email-details";
import { buildPrepaidSuccessAdminEmail } from "./build-prepaid-success-admin-email";
import { buildPrepaidSuccessCustomerEmail } from "./build-prepaid-success-customer-email";
import type { BookingRepository } from "../repository";

const ADMIN_FROM_ADDRESS = "CleanPerfecto Bookings <notifications@cleanperfecto.com>";
const CUSTOMER_FROM_ADDRESS = "CleanPerfecto <support@cleanperfecto.com>";

/**
 * Sends the prepaid-package admin + customer emails. Called only after a
 * verified Stripe payment activates the package — see
 * webhook/process-stripe-webhook-event.ts. Best-effort, same resilience
 * philosophy as sendNormalBookingConfirmationEmails.
 */
export async function sendPrepaidPackageSuccessEmails(repo: BookingRepository, bookingOrderId: string): Promise<void> {
  const details = await loadBookingEmailDetails(repo, bookingOrderId);
  if (!details) {
    console.error(`[booking-email] could not load details for prepaid success email; bookingOrderId=${bookingOrderId}`);
    return;
  }

  let resend: ReturnType<typeof createResendClient>;
  try {
    resend = createResendClient();
  } catch {
    console.error(`[booking-email] resend client unavailable; bookingOrderId=${bookingOrderId}`);
    return;
  }

  const recipients = parseQuoteNotificationRecipients(process.env.QUOTE_NOTIFICATION_EMAILS);
  if (recipients.length > 0) {
    const admin = buildPrepaidSuccessAdminEmail(details);
    const settled = await Promise.allSettled(
      recipients.map((to) =>
        resend.emails.send({ from: ADMIN_FROM_ADDRESS, to, subject: admin.subject, text: admin.text, html: admin.html, replyTo: SITE_CONTACT.email })
      )
    );
    settled.forEach((outcome, index) => {
      const failed = outcome.status === "rejected" || outcome.value.error;
      if (failed) {
        console.error(`[booking-email] prepaid success admin email failed; bookingOrderId=${bookingOrderId} recipientIndex=${index}`);
      }
    });
  } else {
    console.warn(`[booking-email] no QUOTE_NOTIFICATION_EMAILS recipients configured; bookingOrderId=${bookingOrderId}`);
  }

  if (details.customerEmail) {
    const customer = buildPrepaidSuccessCustomerEmail(details);
    try {
      const result = await resend.emails.send({
        from: CUSTOMER_FROM_ADDRESS,
        to: details.customerEmail,
        subject: customer.subject,
        text: customer.text,
        html: customer.html,
        replyTo: SITE_CONTACT.email,
      });
      if (result.error) {
        console.error(`[booking-email] prepaid success customer email failed; bookingOrderId=${bookingOrderId}`);
      }
    } catch {
      console.error(`[booking-email] prepaid success customer email threw; bookingOrderId=${bookingOrderId}`);
    }
  }
}
