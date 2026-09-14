/**
 * Deterministic classification of a Stripe PaymentIntent's own status into
 * whether an already-frozen service_visit_payments row may safely REUSE it
 * (return its existing client_secret, never creating a second PaymentIntent)
 * or must instead treat it as dead and create a fresh one.
 *
 * The overriding safety rule is "never allow a duplicate charge" — so this
 * is deliberately biased toward "reuse" whenever there is any doubt: only a
 * definitively-dead intent (canceled, which Stripe permanently refuses to
 * ever confirm again) is classified as requiring a fresh intent. An
 * already-`succeeded` intent is classified "reuse" too — not because it
 * needs reconfirming, but because the alternative (spinning up a second
 * PaymentIntent for a visit that's already been paid) is exactly the
 * duplicate-charge outcome this exists to prevent; the caller's own
 * `service_visit_payments.status === "paid"` short-circuit (set by webhook
 * reconciliation — see reconcile-visit-payment.ts) is the real source of
 * truth for "already paid" and normally intercepts this case earlier.
 *
 * Stripe's full PaymentIntent.Status union (from the installed `stripe`
 * package): canceled | processing | requires_action | requires_capture |
 * requires_confirmation | requires_payment_method | succeeded. This
 * codebase only ever creates automatic-capture intents, so
 * `requires_capture` is not expected in practice; it is nonetheless
 * classified "reuse" below for the same duplicate-charge-avoidance reason —
 * an intent awaiting capture must never be abandoned for a fresh one.
 */
export type PaymentIntentRetryDecision = "reuse" | "fresh_intent_required";

const REQUIRES_FRESH_INTENT: ReadonlySet<string> = new Set(["canceled"]);

export function decidePaymentIntentRetry(stripePaymentIntentStatus: string): PaymentIntentRetryDecision {
  return REQUIRES_FRESH_INTENT.has(stripePaymentIntentStatus) ? "fresh_intent_required" : "reuse";
}
