import type { ServiceVisitPricingRow } from "./domain-types";
import { InvalidVisitStateError } from "./errors";
import type { SchedulingRepository } from "./repository";
import type { VisitPaymentGateway } from "@/lib/payments/visit-payment-gateway";

export interface StartVisitPricingRevisionInput {
  serviceVisitId: string;
  actorAdminUserId: string;
  actorRole: string;
  reason: string;
}

/**
 * "Revise & Resend Final Total" — admin entry point. service_visits.status
 * stays 'completed' throughout; only service_visit_pricing/
 * service_visit_payments get a narrower, durable "pricing revision" window
 * (price_status -> 'revision_in_progress'), opened here and closed by the
 * normal estimateVisitPricing -> confirmVisitPricing -> finalizeAndSend
 * sequence an admin runs afterward (see finalize-and-send.ts's own guard
 * widening).
 *
 * Postgres cannot call the Stripe API, so any live PaymentIntent is
 * resolved HERE, in application code, before the atomic RPC ever runs —
 * always via a FRESH retrieve (never trusting a possibly-stale local
 * status column):
 *   - succeeded/processing -> hard-abort, no DB writes, no cancel attempt.
 *   - canceled -> already a dead intent; treated as "no live intent,"
 *     proceed with its id as the expected value.
 *   - anything else (requires_payment_method/requires_capture/
 *     requires_confirmation/requires_action) -> cancel it; hard-abort if
 *     Stripe doesn't confirm the cancel.
 *   - no stripePaymentIntentId at all -> proceed directly with null.
 *
 * The resolved (possibly null) intent id is passed to the
 * start_visit_pricing_revision RPC as its own compare-and-swap input — the
 * RPC's check is defense-in-depth for the narrow gap between this
 * resolution and the RPC's lock acquisition, never a replacement for the
 * fresh-retrieve above.
 */
export async function startVisitPricingRevision(
  repo: SchedulingRepository,
  gateway: VisitPaymentGateway,
  input: StartVisitPricingRevisionInput
): Promise<ServiceVisitPricingRow> {
  const visit = await repo.findServiceVisitById(input.serviceVisitId);
  if (!visit) {
    throw new InvalidVisitStateError(`service_visit ${input.serviceVisitId} not found`);
  }
  if (visit.status !== "completed") {
    throw new InvalidVisitStateError(`service_visit ${input.serviceVisitId} has not completed yet — there is nothing to revise`);
  }

  const pricing = await repo.findServiceVisitPricingByVisitId(input.serviceVisitId);
  if (!pricing) {
    throw new InvalidVisitStateError(`service_visit ${input.serviceVisitId} has no confirmed pricing to revise`);
  }
  // Idempotent re-entry — a double-click or retried request. The RPC
  // itself is the authoritative no-op here too; returning early just
  // avoids an unnecessary Stripe retrieve/cancel call.
  if (pricing.priceStatus === "revision_in_progress") {
    return pricing;
  }
  if (pricing.priceStatus !== "confirmed") {
    throw new InvalidVisitStateError(`service_visit ${input.serviceVisitId}'s pricing is not confirmed — there is nothing to revise`);
  }

  const payment = await repo.findServiceVisitPaymentByVisitId(input.serviceVisitId);
  if (payment && (payment.status === "paid" || payment.status === "partially_refunded" || payment.status === "refunded")) {
    throw new InvalidVisitStateError("This visit has already been paid — use Issue Refund instead of revising the Final Total.");
  }

  let expectedPaymentIntentId: string | null = null;
  if (payment?.stripePaymentIntentId) {
    const intent = await gateway.retrievePaymentIntent(payment.stripePaymentIntentId);
    if (intent.status === "succeeded") {
      throw new InvalidVisitStateError(
        "This payment appears to have just succeeded. Refresh and check Payment status; if Paid, use Issue Refund."
      );
    }
    if (intent.status === "processing") {
      throw new InvalidVisitStateError(
        "A payment for this visit is actively processing and cannot be safely stopped. Wait for it to resolve, then retry — if it completed, use Issue Refund."
      );
    }
    if (intent.status === "canceled") {
      expectedPaymentIntentId = intent.id;
    } else {
      const cancelled = await gateway.cancelPaymentIntent(payment.stripePaymentIntentId);
      if (cancelled.status !== "canceled") {
        throw new InvalidVisitStateError("This payment could not be safely stopped. Refresh and check Payment status before retrying.");
      }
      expectedPaymentIntentId = cancelled.id;
    }
  }

  const result = await repo.startVisitPricingRevision({
    serviceVisitId: input.serviceVisitId,
    actorAdminUserId: input.actorAdminUserId,
    actorRole: input.actorRole,
    reason: input.reason,
    expectedPaymentIntentId,
  });

  if (!result.ok) {
    switch (result.reason) {
      case "not_completed":
        throw new InvalidVisitStateError(`service_visit ${input.serviceVisitId} has not completed yet — there is nothing to revise`);
      case "pricing_not_confirmed":
        throw new InvalidVisitStateError(`service_visit ${input.serviceVisitId}'s pricing is not confirmed — there is nothing to revise`);
      case "already_paid":
        throw new InvalidVisitStateError("This visit has already been paid — use Issue Refund instead of revising the Final Total.");
      case "payment_attempt_in_progress":
        throw new InvalidVisitStateError("A payment attempt is in progress for this visit — please wait and retry.");
      case "concurrent_modification":
        throw new InvalidVisitStateError("Something changed on this visit — please refresh and retry.");
    }
  }

  return result.pricing;
}
