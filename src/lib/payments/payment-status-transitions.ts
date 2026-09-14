import type { ServiceVisitPaymentStatus } from "@/lib/scheduling/types";

/**
 * The single source of truth for which service_visit_payments.status values
 * a Stripe webhook (or refund) reconciliation may transition FROM, for each
 * reachable target — the guard that makes a stale/out-of-order/duplicate
 * Stripe event physically incapable of regressing a payment's state (e.g.
 * paid -> processing, refunded -> paid, partially_refunded -> processing
 * must never happen). Enforced at the repository layer via a conditional
 * update (same compare-and-swap idiom as updateBookingOrderStatus's
 * expectedStatus), not just checked in application code, so it holds even
 * under concurrent webhook deliveries.
 *
 * Only status values reachable via reconcileVisitPayment/
 * reconcileVisitPaymentRefund are covered here — `created` (row-creation
 * time) and `no_payment_due` (the zero-collectible freeze outcome) are set
 * by their own dedicated repository methods, never by this reconciliation
 * path, so they never appear as a target below.
 *
 * Each target status always includes itself, so a duplicate/redelivered
 * Stripe event for the exact same outcome is a safe idempotent no-op
 * rather than a blocked transition.
 */
export const PAYMENT_STATUS_TRANSITIONS = {
  // A retry can move a previously-failed/actionable attempt back into
  // processing/requires_action on the SAME PaymentIntent — see the retry
  // decision model (create-visit-payment-intent.ts) for which PaymentIntent
  // statuses are actually safe to reconfirm this way.
  processing: ["created", "processing", "requires_action", "payment_failed"],
  requires_action: ["created", "processing", "requires_action", "payment_failed"],
  // payment_intent.canceled also reconciles through this target (see
  // process-stripe-webhook-event.ts) — a canceled intent is, from the
  // collections/scheduling perspective, indistinguishable from any other
  // "this attempt did not result in payment" outcome, so it reuses the
  // existing failure semantics (distinguished via failureCode) rather than
  // inventing a new DB status.
  payment_failed: ["created", "processing", "requires_action", "payment_failed"],
  // A prior failure/action-required outcome can still succeed on a retry
  // against the same frozen PaymentIntent.
  paid: ["created", "processing", "requires_action", "payment_failed", "paid"],
  // Once paid, only refund progression is ever valid — never back to
  // processing/requires_action/payment_failed/created.
  partially_refunded: ["paid", "partially_refunded"],
  // Fully terminal: once refunded, no further status change of any kind is
  // valid except an idempotent redelivery of the same refunded event.
  refunded: ["paid", "partially_refunded", "refunded"],
} as const satisfies Record<string, readonly ServiceVisitPaymentStatus[]>;

export type ReconcilableAttemptStatus = keyof typeof PAYMENT_STATUS_TRANSITIONS;

export function allowedFromStatusesFor(target: ReconcilableAttemptStatus): readonly ServiceVisitPaymentStatus[] {
  return PAYMENT_STATUS_TRANSITIONS[target];
}

export function isPaymentStatusTransitionAllowed(from: ServiceVisitPaymentStatus, to: ReconcilableAttemptStatus): boolean {
  return (PAYMENT_STATUS_TRANSITIONS[to] as readonly ServiceVisitPaymentStatus[]).includes(from);
}
