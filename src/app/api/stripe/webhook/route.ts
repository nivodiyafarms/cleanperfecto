import { getStripeClient } from "@/lib/booking/stripe/client";
import { createSupabaseBookingRepository } from "@/lib/booking/supabase-booking-repository";
import { claimWebhookEvent } from "@/lib/booking/webhook/claim-webhook-event";
import { processStripeWebhookEvent } from "@/lib/booking/webhook/process-stripe-webhook-event";
import { createSupabaseConsentRepository } from "@/lib/consent/consent-repository";
import { createSupabaseSchedulingRepository } from "@/lib/scheduling/supabase-scheduling-repository";

// Stripe's Node SDK needs the Node.js runtime (not Edge).
export const runtime = "nodejs";

/**
 * Stripe webhook endpoint. Verifies the signature against the raw request
 * body (Next.js Route Handlers need no special body-parser configuration
 * for this — see request.text() below), then claims the event through the
 * received/processing/processed/failed state machine before running any
 * fulfillment. Returns a 5xx on genuine processing failure so Stripe's own
 * retry schedule redelivers the event — the ledger row stays 'failed'
 * (not 'processed'), so the retry actually reprocesses rather than being
 * skipped. See src/lib/booking/webhook/ for the fulfillment logic itself.
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
  const claim = await claimWebhookEvent(repo, event.id, event.type, event as unknown as Record<string, unknown>);

  if (!claim.shouldProcess) {
    // A prior delivery of this exact event id already reached
    // 'processed' — safe, permanent no-op.
    return new Response("ok", { status: 200 });
  }

  try {
    await processStripeWebhookEvent(stripe, repo, event, schedulingRepo, consentRepo);
    await repo.markWebhookEventProcessed(claim.eventRowId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown processing error";
    await repo.markWebhookEventFailed(claim.eventRowId, message);
    return new Response(`Webhook processing failed: ${message}`, { status: 500 });
  }

  return new Response("ok", { status: 200 });
}
