import type { InstantQuoteEmailDetails } from "./build-email-details";

export interface InstantQuoteAdminNotificationSummary {
  /** False when QUOTE_NOTIFICATION_EMAILS had no valid recipients configured. */
  configured: boolean;
  attempted: number;
  sent: number;
}

export interface InstantQuoteCustomerEmailResult {
  /** False when there was no customer email to send to at all (phone-only submission) — never an error. */
  attempted: boolean;
  sent: boolean;
}

/**
 * The trusted instant-quote core never depends on this — email sending is
 * a side effect of the production server action only (see
 * submit-instant-quote-request.ts). Tests inject a fake implementation;
 * see resend-instant-quote-email-sender.ts for the real Resend-backed one.
 */
export interface InstantQuoteEmailSender {
  sendAdminNotification(details: InstantQuoteEmailDetails): Promise<InstantQuoteAdminNotificationSummary>;
  sendCustomerConfirmation(details: InstantQuoteEmailDetails): Promise<InstantQuoteCustomerEmailResult>;
}
