export interface NotificationEmailSendInput {
  to: string;
  subject: string;
  text: string;
  html: string;
  /** The notification row's own deterministic idempotency_key, reused as-is for the provider's own idempotency header — see resend-notification-email-sender.ts. */
  idempotencyKey: string;
}

export interface NotificationEmailSendResult {
  sent: boolean;
  providerMessageId?: string | null;
  failureReason?: string;
}

/**
 * The trusted dispatcher core (dispatch-due-notifications.ts) never depends
 * on Resend directly — same "inject the send seam" pattern as
 * InstantQuoteEmailSender (src/lib/instant-quote/email/sender.ts). Tests
 * and disposable validation use a fake; see
 * resend-notification-email-sender.ts for the real, production, Resend-
 * backed implementation.
 */
export interface NotificationEmailSender {
  send(input: NotificationEmailSendInput): Promise<NotificationEmailSendResult>;
}
