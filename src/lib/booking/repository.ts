import type { CompletedServiceHistoryRepository } from "@/lib/instant-quote/eligibility-repository";
import type {
  BookingOrderRow,
  BookingOrderStatus,
  NewBookingOrderRow,
  NewPaymentAttemptRow,
  NewPrepaidPackageRow,
  PaymentAttemptRow,
  PaymentAttemptStatusPatch,
  QuoteRequestForBookingRow,
  WebhookClaim,
} from "./types";

export interface CustomerStripeInfo {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  stripeCustomerId: string | null;
}

/**
 * Everything the booking module needs from persistence, combined into one
 * interface (same shape as InstantQuoteRepository in
 * src/lib/instant-quote/repository.ts). CompletedServiceHistoryRepository is
 * reused, not reimplemented — a booking's fresh first-cleaning-eligibility
 * recompute uses the exact same service_visits lookups the quote pipeline
 * already trusts. See supabase-booking-repository.ts for the production
 * implementation.
 */
export interface BookingRepository extends CompletedServiceHistoryRepository {
  findQuoteRequestById(id: string): Promise<QuoteRequestForBookingRow | null>;

  getCustomerForStripe(customerId: string): Promise<CustomerStripeInfo | null>;
  setCustomerStripeId(customerId: string, stripeCustomerId: string): Promise<void>;

  /** Insert-or-fetch by client_request_id — see booking_orders migration comments. Always returns the single authoritative row for that token, whether this call created it or a prior one did. */
  insertBookingOrder(row: NewBookingOrderRow): Promise<BookingOrderRow>;
  findBookingOrderById(id: string): Promise<BookingOrderRow | null>;
  /** Conditional UPDATE (`WHERE status = expectedStatus`). Returns whether a row actually changed, so callers only fire side effects (emails, package activation) on the run that performed the real transition. */
  updateBookingOrderStatus(id: string, expectedStatus: BookingOrderStatus, nextStatus: BookingOrderStatus): Promise<boolean>;

  /** A still-open (created/processing) attempt for this booking order, if any — see the two-layer Checkout idempotency design. */
  findActivePaymentAttempt(bookingOrderId: string): Promise<PaymentAttemptRow | null>;
  insertPaymentAttempt(row: NewPaymentAttemptRow): Promise<PaymentAttemptRow>;
  updatePaymentAttemptBySessionId(sessionId: string, patch: PaymentAttemptStatusPatch): Promise<void>;
  findPaymentAttemptBySessionId(sessionId: string): Promise<PaymentAttemptRow | null>;

  /** `insert ... on conflict (booking_order_id) do nothing` — inserted:false means a package already exists for this booking order (domain-level idempotency, independent of the webhook ledger). */
  activatePrepaidPackage(row: NewPrepaidPackageRow): Promise<{ inserted: boolean }>;

  /** Claim-or-resume a webhook event per the received/processing/processed/failed state machine — see stripe_webhook_events migration comments. */
  claimWebhookEvent(stripeEventId: string, eventType: string, payload: unknown): Promise<WebhookClaim>;
  markWebhookEventProcessed(eventRowId: string): Promise<void>;
  markWebhookEventFailed(eventRowId: string, reason: string): Promise<void>;
}
