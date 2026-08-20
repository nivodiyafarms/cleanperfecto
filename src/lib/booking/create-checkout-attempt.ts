import "server-only";

import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import type { BookingRepository } from "./repository";
import type { PaymentAttemptMode, PaymentMethodType } from "./types";

export interface GetOrCreateCheckoutSessionUrlParams {
  repo: BookingRepository;
  stripe: Stripe;
  bookingOrderId: string;
  mode: PaymentAttemptMode;
  stripeCustomerId: string;
  /** Null for setup mode. */
  amount: number | null;
  /** Null for setup mode and for any mode where payment method isn't yet meaningful. */
  paymentMethodType?: PaymentMethodType | null;
  /** ACH prepaid attempts only — the trusted card subtotal before the 1% ACH incentive. Null otherwise. */
  packageSubtotalBeforeAchIncentive?: number | null;
  /** ACH prepaid attempts only — the dollar amount saved by the ACH incentive. Null otherwise. */
  achSavingsAmount?: number | null;
  /** Receives a freshly generated idempotency key for exactly this one Stripe create-call. */
  createSession: (idempotencyKey: string) => Promise<Stripe.Checkout.Session>;
}

/**
 * The "one active Checkout Session per booking order, safe retry after
 * expiry" half of booking-creation idempotency (the other half —
 * "one booking_orders row per submission" — lives in
 * repository.insertBookingOrder). Reuses a still-open prior attempt's
 * session URL when one exists; otherwise creates a fresh attempt with a
 * fresh Stripe idempotency key, so an expired/failed session can always be
 * retried without ever creating a second booking order.
 */
export async function getOrCreateCheckoutSessionUrl(params: GetOrCreateCheckoutSessionUrlParams): Promise<string> {
  const active = await params.repo.findActivePaymentAttempt(params.bookingOrderId);
  if (active) {
    const liveSession = await params.stripe.checkout.sessions.retrieve(active.stripeCheckoutSessionId);
    if (liveSession.status === "open" && liveSession.url) {
      return liveSession.url;
    }
    // Falls through: our DB still shows created/processing but Stripe's
    // own session status says otherwise (e.g. expired, and the expiry
    // webhook hasn't landed yet) — create a fresh attempt below rather
    // than sending the customer to a dead session.
  }

  const idempotencyKey = randomUUID();
  const session = await params.createSession(idempotencyKey);
  if (!session.url) {
    throw new Error("[booking] Stripe Checkout Session created with no url");
  }

  await params.repo.insertPaymentAttempt({
    bookingOrderId: params.bookingOrderId,
    mode: params.mode,
    stripeCheckoutSessionId: session.id,
    stripeCustomerId: params.stripeCustomerId,
    amount: params.amount,
    paymentMethodType: params.paymentMethodType ?? null,
    packageSubtotalBeforeAchIncentive: params.packageSubtotalBeforeAchIncentive ?? null,
    achSavingsAmount: params.achSavingsAmount ?? null,
  });

  return session.url;
}
