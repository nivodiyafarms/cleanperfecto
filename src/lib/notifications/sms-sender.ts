export interface NotificationSmsSendInput {
  to: string;
  body: string;
  idempotencyKey: string;
}

export interface NotificationSmsSendResult {
  sent: boolean;
  providerMessageId?: string | null;
  failureReason?: string;
}

/** Mirrors NotificationEmailSender's injectable-seam shape for the SMS channel. */
export interface NotificationSmsSender {
  send(input: NotificationSmsSendInput): Promise<NotificationSmsSendResult>;
}

/**
 * The real "production" SMS sender for THIS milestone — deliberately not a
 * Twilio (or any other provider) integration. Twilio is intentionally not
 * installed/configured in Notifications V1 (owner-approved scope). This
 * makes it structurally impossible for a real SMS to be sent by this
 * codebase right now, regardless of environment/config: even if the
 * dispatcher is ever pointed at production, every sms-channel row fails
 * immediately with a clear, non-retryable reason rather than attempting a
 * real send or silently pretending to succeed. Swapping in a real Twilio-
 * backed NotificationSmsSender is the "small later activation step" — this
 * function is the seam that gets replaced then, nothing else.
 */
export function createNotYetSupportedNotificationSmsSender(): NotificationSmsSender {
  return {
    async send(): Promise<NotificationSmsSendResult> {
      return { sent: false, failureReason: "SMS provider not yet configured (Twilio activation pending) — no real SMS is sent by this milestone" };
    },
  };
}
