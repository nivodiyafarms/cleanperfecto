import { getStripeClient } from "@/lib/booking/stripe/client";
import { createSupabaseBookingRepository } from "@/lib/booking/supabase-booking-repository";
import { claimAndProcessStripeWebhookEvent } from "@/lib/booking/webhook/claim-and-process-stripe-webhook-event";
import { createSupabaseConsentRepository } from "@/lib/consent/consent-repository";
import { createStripeVisitPaymentGateway } from "@/lib/payments/visit-payment-gateway";
import { createSupabaseSchedulingRepository } from "@/lib/scheduling/supabase-scheduling-repository";

// Stripe's Node SDK needs the Node.js runtime (not Edge).
export const runtime = "nodejs";

/**
 * Stripe webhook endpoint. Verifies the signature against the raw request
 * body (Next.js Route Handlers need no special body-parser configuration
 * for this — see request.text() below), then delegates the claim/process/
 * mark sequence to claimAndProcessStripeWebhookEvent (shared with the
 * stuck-event retry sweep — see src/app/api/cron/retry-stuck-webhook-events).
 * Returns a 5xx on genuine processing failure so Stripe's own retry
 * schedule redelivers the event — the ledger row stays 'failed' (not
 * 'processed'), so the retry actually reprocesses rather than being
 * skipped. A "skipped" outcome (already processed, OR another delivery
 * currently holds an unexpired processing lease) still returns 200 — the
 * retry sweep is what guarantees a lease that's never released eventually
 * gets revisited, not a 5xx here. See src/lib/booking/webhook/ for the
 * fulfillment logic itself.
 */
export async function POST(request: Request): Promise<Response> {
  const signature = request.headers.get("stripe-signature");
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!signature || !webhookSecret) {
    return new Response("Webhook not configured", { status: 400 });
  }

  const rawBody = await request.text();
  const stripe = getStripeClient();

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid signature";
    return new Response(`Webhook signature verification failed: ${message}`, { status: 400 });
  }

  const repo = createSupabaseBookingRepository();
  const schedulingRepo = createSupabaseSchedulingRepository();
  const consentRepo = createSupabaseConsentRepository();
  const paymentGateway = createStripeVisitPaymentGateway();

  const result = await claimAndProcessStripeWebhookEvent(stripe, repo, event, schedulingRepo, consentRepo, paymentGateway);
  if (result.outcome === "failed") {
    return new Response(`Webhook processing failed: ${result.error}`, { status: 500 });
  }

  return new Response("ok", { status: 200 });
}
