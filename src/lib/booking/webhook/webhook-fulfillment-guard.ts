import type { PaymentMode } from "@/lib/config/runtime-env";

export interface WebhookFulfillmentDecision {
  allowed: boolean;
  /** Present only when `allowed` is false — never logged/returned to Stripe, purely for the caller's own diagnostics. */
  reason?: string;
}

/**
 * Gate applied once, before ANY Stripe webhook event is dispatched to a
 * fulfillment branch (checkout session completion, PaymentIntent
 * reconciliation, refund reconciliation) — after signature verification,
 * after the event has already been claimed/recorded in the audit ledger
 * (see route.ts / claimWebhookEvent), but before any application state is
 * touched. Stripe webhook secrets (`whsec_...`) don't reveal test/live
 * mode by themselves, so the verified event's own `livemode` flag is the
 * only trustworthy signal once the signature has been checked.
 *
 * `disabled`/`external_only` block ALL Stripe-card fulfillment outright —
 * in those modes the application never creates a stripe_card SetupIntent
 * or PaymentIntent in the first place (see payment-capabilities.ts), so a
 * webhook event arriving for one is either stale (a mode change happened
 * after it was created) or unrelated Stripe Dashboard/Payment Link
 * activity — never something this app should turn into a booking/package
 * activation or a service-visit payment-status change.
 *
 * A denied decision is a safe no-op, not a processing failure: the caller
 * still marks the webhook-event ledger row 'processed' (Stripe must not
 * retry it forever), it just never reaches a mutation.
 */
export function resolveWebhookFulfillmentDecision(
  paymentMode: PaymentMode,
  event: { livemode: boolean }
): WebhookFulfillmentDecision {
  if (paymentMode === "disabled" || paymentMode === "external_only") {
    return { allowed: false, reason: `PAYMENT_MODE="${paymentMode}" does not permit Stripe card-payment fulfillment.` };
  }
  if (paymentMode === "stripe_sandbox" && event.livemode) {
    return {
      allowed: false,
      reason: "Received a LIVE-mode Stripe event while PAYMENT_MODE=stripe_sandbox (test-mode events only).",
    };
  }
  if (paymentMode === "stripe_enabled" && !event.livemode) {
    return {
      allowed: false,
      reason: "Received a TEST-mode Stripe event while PAYMENT_MODE=stripe_enabled (live-mode events only).",
    };
  }
  return { allowed: true };
}
