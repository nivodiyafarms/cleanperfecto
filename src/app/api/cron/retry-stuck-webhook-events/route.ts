import "server-only";

import { NextResponse, type NextRequest } from "next/server";
import { getStripeClient } from "@/lib/booking/stripe/client";
import { createSupabaseBookingRepository } from "@/lib/booking/supabase-booking-repository";
import { retryStuckWebhookEvents } from "@/lib/booking/webhook/retry-stuck-webhook-events";
import { isCronRequestAuthorized } from "@/lib/notifications/cron-auth";
import { createSupabaseConsentRepository } from "@/lib/consent/consent-repository";
import { createStripeVisitPaymentGateway } from "@/lib/payments/visit-payment-gateway";
import { createSupabaseSchedulingRepository } from "@/lib/scheduling/supabase-scheduling-repository";

export const runtime = "nodejs";

/**
 * Invoked every 5 minutes by Supabase Cron (pg_cron + pg_net — same
 * infrastructure and manual per-environment cron.schedule()/Vault-secret
 * setup as src/app/api/cron/dispatch-notifications, see that route's own
 * doc comment and 20260826090200_enable_pg_cron_and_pg_net_for_notification_dispatch.sql).
 * Not a Supabase Edge Function for the same reason: a bounded DB-backed
 * batch of work, well within a normal serverless function's timeout.
 *
 * This is the backstop for src/lib/booking/webhook/retry-stuck-webhook-events.ts's
 * own doc comment: claim_stripe_webhook_event()'s lease makes a stuck
 * 'processing' row reclaimable, but nothing about the lease itself
 * schedules a future attempt — and a 'failed' row has no guarantee Stripe
 * will ever redeliver it again (Stripe's own retry schedule can be
 * exhausted, or a concurrent delivery that was correctly refused may have
 * already returned 200 for the event id, which tells Stripe not to retry
 * at all). This route is what actually guarantees eventual completion,
 * independent of Stripe's redelivery behavior, by replaying each
 * candidate from its own already-verified stored payload.
 *
 * Auth: a shared secret compared with a constant-time check (see
 * cron-auth.ts) — distinct from CRON_DISPATCH_SECRET, same per-job-secret
 * convention as Notifications V1.
 */
async function handleRetry(request: NextRequest): Promise<NextResponse> {
  if (!isCronRequestAuthorized(request.headers.get("x-cron-secret"), process.env.CRON_WEBHOOK_RETRY_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const stripe = getStripeClient();
  const repo = createSupabaseBookingRepository();
  const schedulingRepo = createSupabaseSchedulingRepository();
  const consentRepo = createSupabaseConsentRepository();
  const paymentGateway = createStripeVisitPaymentGateway();

  const result = await retryStuckWebhookEvents(stripe, repo, schedulingRepo, consentRepo, paymentGateway);
  return NextResponse.json({ ok: true, ...result });
}

export async function POST(request: NextRequest) {
  return handleRetry(request);
}

export async function GET(request: NextRequest) {
  return handleRetry(request);
}
