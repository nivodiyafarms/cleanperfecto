/** How long a freshly created or renewed agreed-quote offer stays acceptable before it needs an explicit staff Renew. Never extended by a plain resend — see send-agreed-quote-invitation.ts. */
export const AGREED_QUOTE_INVITATION_VALIDITY_DAYS = 14;

/** Send/resend/renew-send rate limiting — same order of magnitude as claim_payment_link_resend's visit-scoped limits, scoped per invitation instead. */
export const AGREED_QUOTE_INVITATION_SEND_COOLDOWN_SECONDS = 30;
export const AGREED_QUOTE_INVITATION_SEND_RATE_LIMIT_WINDOW_SECONDS = 3600;
export const AGREED_QUOTE_INVITATION_SEND_RATE_LIMIT_MAX = 5;
