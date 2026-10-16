import type { CalculationInput, CalculationResult } from "@/lib/pricing/types";

export type AgreedQuoteInvitationStatus = "pending_send" | "sent" | "checkout_in_progress" | "completed" | "cancelled" | "superseded";

export type NegotiationChannel = "facebook" | "marketplace" | "phone" | "text" | "email" | "other";

export interface AgreedQuoteInvitationRow {
  id: string;
  quoteRequestId: string;
  customerId: string;
  createdByAdminUserId: string;
  status: AgreedQuoteInvitationStatus;
  clientRequestId: string;
  negotiationChannel: NegotiationChannel | null;
  negotiationNotes: string | null;
  agreedRequestedDate: string | null;
  agreedRequestedStartTime: string | null;
  resendCount: number;
  lastSentAt: string | null;
  expiresAt: string;
  renewCount: number;
  renewedAt: string | null;
  renewedByAdminUserId: string | null;
  supersedesInvitationId: string | null;
  supersededAt: string | null;
  bookingOrderId: string | null;
  checkoutStartedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  cancelledByAdminUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NewAgreedQuoteInvitationRow {
  quoteRequestId: string;
  customerId: string;
  createdByAdminUserId: string;
  clientRequestId: string;
  negotiationChannel: NegotiationChannel | null;
  negotiationNotes: string | null;
  agreedRequestedDate: string | null;
  agreedRequestedStartTime: string | null;
  expiresAt: string;
  supersedesInvitationId: string | null;
}

export interface AgreedQuoteInvitationSendRow {
  id: string;
  invitationId: string;
  idempotencyKey: string;
  status: "sending" | "sent" | "failed_terminal";
  failureReason: string | null;
}

/** For the admin list/detail views — joins in just enough of the quote's frozen scope/price for display, without exposing the raw pricing_snapshot shape to callers that don't need it. */
export interface AgreedQuoteInvitationSummary extends AgreedQuoteInvitationRow {
  customerName: string;
  customerEmail: string | null;
  cleaningType: "standard" | "deep" | "move";
  calculationInput: CalculationInput;
  calculationResult: CalculationResult;
}

/**
 * Persistence seam for the agreed-quote invitation lifecycle — kept
 * separate from InstantQuoteRepository/BookingRepository (which this
 * feature also depends on) since agreed_quote_invitations is its own
 * table with its own atomic-claim RPCs. See
 * supabase-agreed-quote-invitation-repository.ts for the production impl.
 */
export interface AgreedQuoteInvitationRepository {
  insertAgreedQuoteInvitation(row: NewAgreedQuoteInvitationRow): Promise<AgreedQuoteInvitationRow>;
  findAgreedQuoteInvitationById(id: string): Promise<AgreedQuoteInvitationRow | null>;
  findAgreedQuoteInvitationSummaryById(id: string): Promise<AgreedQuoteInvitationSummary | null>;
  listAgreedQuoteInvitationSummaries(): Promise<AgreedQuoteInvitationSummary[]>;

  /** Atomic `UPDATE ... WHERE id=$old AND status IN ('pending_send','sent')` — null when refused (already checkout_in_progress/completed/cancelled/superseded). */
  supersedeAgreedQuoteInvitation(oldInvitationId: string, now: Date): Promise<AgreedQuoteInvitationRow | null>;

  /** Raises 'duplicate_request'/'rate_limited' (see claim_agreed_quote_invitation_send). */
  claimAgreedQuoteInvitationSend(
    invitationId: string,
    idempotencyKey: string,
    now: Date,
    cooldownSeconds: number,
    rateLimitWindowSeconds: number,
    rateLimitMax: number
  ): Promise<AgreedQuoteInvitationSendRow>;
  markAgreedQuoteInvitationSendSent(sendId: string, providerMessageId: string | null): Promise<void>;
  markAgreedQuoteInvitationSendFailedTerminal(sendId: string, failureReason: string): Promise<void>;
  /** status: pending_send -> sent (no-op if already sent/checkout_in_progress); resend_count/last_sent_at always bumped. Never touches expires_at. */
  recordAgreedQuoteInvitationSent(invitationId: string, nextResendCount: number, sentAt: Date): Promise<void>;

  /** Null when blocked by status (already completed/cancelled/superseded). */
  renewAgreedQuoteInvitation(
    invitationId: string,
    nextExpiresAt: Date,
    nextRenewCount: number,
    renewedAt: Date,
    renewedByAdminUserId: string
  ): Promise<AgreedQuoteInvitationRow | null>;

  /** The §3-step-6 guarded link-and-recheck — null when a concurrent cancel won the race (status is no longer 'checkout_in_progress'). */
  linkAgreedQuoteInvitationBookingOrder(invitationId: string, bookingOrderId: string): Promise<AgreedQuoteInvitationRow | null>;

  /** Null when the claim is refused (ownership/status/expiry) — see claim_agreed_quote_invitation_checkout. */
  claimAgreedQuoteInvitationCheckout(invitationId: string, customerId: string, now: Date): Promise<AgreedQuoteInvitationRow | null>;

  /** Null when the cancellation is refused (status, or a live Stripe attempt still exists) — see claim_agreed_quote_invitation_cancellation. */
  claimAgreedQuoteInvitationCancellation(invitationId: string, adminUserId: string, now: Date): Promise<AgreedQuoteInvitationRow | null>;

  /** Webhook completion hook — a no-op (zero rows) unless this booking order came from an agreed-quote invitation currently 'checkout_in_progress'. */
  markAgreedQuoteInvitationCompletedByBookingOrderId(bookingOrderId: string, completedAt: Date): Promise<void>;

  /** True when a non-terminal (created/processing) payment_attempts row exists for the invitation's booking order — the "is there a live session" check §4/§6 UI logic needs. False (never throws) when bookingOrderId is null. */
  hasLivePaymentAttemptForBookingOrder(bookingOrderId: string | null): Promise<boolean>;
}
