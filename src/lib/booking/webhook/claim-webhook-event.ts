import type { BookingRepository } from "../repository";
import type { WebhookClaim } from "../types";

/**
 * Claim-or-resume a Stripe webhook delivery per the received/processing/
 * processed/failed state machine (see the stripe_webhook_events migration
 * and BookingRepository.claimWebhookEvent). `shouldProcess: false` is the
 * ONLY safe signal to skip fulfillment — it means a prior delivery of this
 * exact event id already reached 'processed'. Every other outcome
 * (first delivery, or a redelivery of a 'received'/'failed' row — the
 * crash-recovery case) means fulfillment must run again; existence of the
 * row alone is never treated as proof that processing completed.
 */
export async function claimWebhookEvent(
  repo: BookingRepository,
  stripeEventId: string,
  eventType: string,
  payload: unknown
): Promise<WebhookClaim> {
  return repo.claimWebhookEvent(stripeEventId, eventType, payload);
}
