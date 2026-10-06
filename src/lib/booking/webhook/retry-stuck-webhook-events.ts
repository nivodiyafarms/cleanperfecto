import "server-only";

import type Stripe from "stripe";
import type { ConsentRepository } from "@/lib/consent/consent-repository";
import type { PaymentMode } from "@/lib/config/runtime-env";
import type { VisitPaymentGateway } from "@/lib/payments/visit-payment-gateway";
import type { SchedulingRepository } from "@/lib/scheduling/repository";
import type { BookingRepository } from "../repository";
import { claimAndProcessStripeWebhookEvent } from "./claim-and-process-stripe-webhook-event";

export const WEBHOOK_PROCESSING_LEASE_SECONDS = 300;

export interface RetryStuckWebhookEventsResult {
  attempted: number;
  processed: number;
  skipped: number;
  failed: number;
}

/**
 * The backstop claim_stripe_webhook_event()'s lease makes possible but does
 * not itself schedule: a 'processing' row past its lease, or a 'failed'
 * row, has no guarantee any future Stripe delivery will ever arrive to
 * reclaim it — a request that got a 200 (even from a concurrent delivery
 * that was correctly refused, not the one actually doing the work) tells
 * Stripe the event is handled and it will not retry. Invoked on a cron
 * (see src/app/api/cron/retry-stuck-webhook-events), this is what actually
 * guarantees interrupted processing eventually completes: it replays each
 * candidate from its OWN stored payload (already signature-verified at
 * original receipt) through the exact same claim/process/mark pipeline a
 * live Stripe delivery uses, so a row only gets reprocessed if it still
 * genuinely qualifies (failed, or processing past its lease) at the moment
 * this runs — a row a live delivery is legitimately still/again working
 * right now is correctly left alone.
 */
export async function retryStuckWebhookEvents(
  stripe: Stripe,
  repo: BookingRepository,
  schedulingRepo?: SchedulingRepository,
  consentRepo?: ConsentRepository,
  paymentGateway?: VisitPaymentGateway,
  now: Date = new Date(),
  limit = 20,
  paymentMode?: PaymentMode
): Promise<RetryStuckWebhookEventsResult> {
  const candidates = await repo.listStuckWebhookEvents(now, WEBHOOK_PROCESSING_LEASE_SECONDS, limit);

  const result: RetryStuckWebhookEventsResult = { attempted: candidates.length, processed: 0, skipped: 0, failed: 0 };

  for (const candidate of candidates) {
    try {
      const event = candidate.payload as unknown as Stripe.Event;
      const outcome = await claimAndProcessStripeWebhookEvent(stripe, repo, event, schedulingRepo, consentRepo, paymentGateway, paymentMode);
      if (outcome.outcome === "processed") result.processed += 1;
      else if (outcome.outcome === "skipped") result.skipped += 1;
      else result.failed += 1;
    } catch (error) {
      // A throw here means the claim attempt itself failed (e.g. a
      // malformed/corrupt stored payload) — distinct from
      // claimAndProcessStripeWebhookEvent's own "failed" outcome, which
      // already catches fulfillment errors and marks the ledger row. One
      // bad candidate must never abort the rest of the batch: every other
      // genuinely stuck event in this sweep still deserves its chance to
      // recover, independent of whichever candidate happened to be broken.
      console.error(`[booking] retryStuckWebhookEvents: candidate ${candidate.stripeEventId} threw during claim/process, skipping:`, error);
      result.failed += 1;
    }
  }

  return result;
}
