import "server-only";

import type Stripe from "stripe";
import type { ConsentRepository } from "@/lib/consent/consent-repository";
import type { PaymentMode } from "@/lib/config/runtime-env";
import type { VisitPaymentGateway } from "@/lib/payments/visit-payment-gateway";
import type { SchedulingRepository } from "@/lib/scheduling/repository";
import type { BookingRepository } from "../repository";
import { claimWebhookEvent } from "./claim-webhook-event";
import { processStripeWebhookEvent } from "./process-stripe-webhook-event";

export type ClaimAndProcessOutcome = { outcome: "skipped" } | { outcome: "processed" } | { outcome: "failed"; error: string };

/**
 * The one place that claims a Stripe webhook delivery and runs its
 * fulfillment — shared by the live webhook route (route.ts, a real HTTP
 * delivery from Stripe) and retryStuckWebhookEvents (the event's own
 * stored payload, replayed because its original delivery crashed or lost
 * the claim race and was never completed by anyone). Identical
 * claim/process/mark sequence either way, so the same exclusivity and
 * idempotency guarantees — including the fact that "skipped" covers both
 * a genuinely already-processed event AND one another delivery currently
 * holds an unexpired lease on — apply regardless of which caller invoked
 * it.
 */
export async function claimAndProcessStripeWebhookEvent(
  stripe: Stripe,
  repo: BookingRepository,
  event: Stripe.Event,
  schedulingRepo?: SchedulingRepository,
  consentRepo?: ConsentRepository,
  paymentGateway?: VisitPaymentGateway,
  paymentMode?: PaymentMode
): Promise<ClaimAndProcessOutcome> {
  const claim = await claimWebhookEvent(repo, event.id, event.type, event as unknown as Record<string, unknown>);

  if (!claim.shouldProcess) {
    return { outcome: "skipped" };
  }

  try {
    await processStripeWebhookEvent(stripe, repo, event, schedulingRepo, consentRepo, paymentGateway, paymentMode);
    await repo.markWebhookEventProcessed(claim.eventRowId, claim.claimToken);
    return { outcome: "processed" };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown processing error";
    await repo.markWebhookEventFailed(claim.eventRowId, message, claim.claimToken);
    return { outcome: "failed", error: message };
  }
}
