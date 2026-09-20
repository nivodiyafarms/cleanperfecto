import type { BookingRepository } from "@/lib/booking/repository";
import type { SchedulingRepository } from "@/lib/scheduling/repository";
import type { TipSelectionType } from "@/lib/scheduling/types";
import { InvalidVisitStateError } from "@/lib/scheduling/errors";
import { completeServiceVisit } from "@/lib/scheduling/complete-service-visit";
import { approveVisitPricingIncrease, confirmVisitPricing } from "@/lib/scheduling/confirm-visit-pricing";
import { selectVisitTip } from "./select-visit-tip";
import { createVisitPaymentIntent, type CreateVisitPaymentIntentOutcome } from "./create-visit-payment-intent";
import type { VisitPaymentGateway } from "./visit-payment-gateway";

export interface ConfirmFinalTotalAndPayInput {
  serviceVisitId: string;
  customerId: string;
  /** Required only once the visit has completed and a charge is actually being authorized — see the "approved_awaiting_completion" early-return below. */
  tipSelectionType?: TipSelectionType;
  customAmount?: number;
}

export type ConfirmFinalTotalAndPayOutcome =
  | { outcome: "approved_awaiting_completion" }
  | CreateVisitPaymentIntentOutcome;

/**
 * The customer's ONE "Confirm Final Total & Pay" click, covering every case
 * on that single screen — unchanged/lower pricing, and a pending price
 * increase — without a separate "approve" round trip through an admin
 * re-confirm. Reuses the existing pricing/payment state machine verbatim
 * (approveVisitPricingIncrease, confirmVisitPricing, selectVisitTip,
 * createVisitPaymentIntent) — no new tables, no relaxed triggers, no
 * invented totals. The server, never the client, decides what "the final
 * total" actually is at every step.
 *
 * If service_visit_pricing.requires_customer_approval is set, this call
 * IS the customer's approval: it clears the gate and confirms the estimate
 * server already computed (confirmedBy records who — "customer:<id>" — for
 * the same durable confirmed_at/confirmed_by/previously_approved_amount
 * evidence trail every admin confirmation uses; nothing new to audit).
 *
 * A price increase can only be resolved this way while pricing is still
 * mutable — service_visit_pricing.price_status and previously_approved_amount
 * are frozen by a BEFORE UPDATE trigger once service_visits.status =
 * 'completed' (see 20260824100400_create_service_visit_pricing.sql), by
 * design: historical completed-visit pricing must never be rewritten. This
 * is exactly why Finalize & Send (finalize-and-send.ts) deliberately leaves
 * a visit at 'work_finished' — never 'completed' — whenever its final
 * pricing still requires customer approval: the approve+confirm step above
 * must still be legal to run when the customer opens their Final Total link.
 *
 * If the visit is 'work_finished' (physical work is done; pricing is now
 * frozen by the approve+confirm above, or was already confirmed with
 * nothing to approve), THIS call also crosses the completion boundary right
 * here — only after pricing is frozen — so the customer's one click both
 * resolves the price increase AND is immediately followed by tip/payment,
 * with no separate "wait for admin" round trip. If the visit hasn't even
 * been cleaned yet (still 'requested'/'scheduled' — the original use case
 * this function was built for: a recurring Pay Per Cleaning price increase
 * proposed ahead of the next visit), approval is captured and this returns
 * "approved_awaiting_completion" — there is genuinely nothing to charge yet.
 * If a price increase is somehow still pending on an ALREADY-completed
 * visit (only reachable via a direct completion bypassing Finalize & Send),
 * the confirm step is rejected by that same trigger; the resulting Postgres
 * error is translated into a clear, actionable InvalidVisitStateError
 * rather than surfacing a raw DB error to the customer.
 *
 * Every step here is idempotent-safe to retry: approveVisitPricingIncrease
 * is a no-op once the gate is already clear, confirmVisitPricing is
 * re-callable, insertServiceVisitPaymentAttempt is insert-or-fetch,
 * selectVisitTip is freely re-callable pre-freeze, and
 * createVisitPaymentIntent reuses (never duplicates) an existing
 * PaymentIntent for this row. A failure after approval/confirmation but
 * before a charge leaves the visit in a fully recoverable state — the next
 * call picks up exactly where this one left off.
 */
export async function confirmFinalTotalAndPay(
  repo: SchedulingRepository,
  bookingRepo: BookingRepository,
  gateway: VisitPaymentGateway,
  input: ConfirmFinalTotalAndPayInput
): Promise<ConfirmFinalTotalAndPayOutcome> {
  const visit = await repo.findServiceVisitById(input.serviceVisitId);
  if (!visit) {
    throw new InvalidVisitStateError(`service_visit ${input.serviceVisitId} not found`);
  }

  let pricing = await repo.findServiceVisitPricingByVisitId(input.serviceVisitId);
  if (!pricing) {
    throw new InvalidVisitStateError(`service_visit ${input.serviceVisitId} has no pricing estimate yet`);
  }

  if (pricing.requiresCustomerApproval) {
    try {
      await approveVisitPricingIncrease(repo, input.serviceVisitId);
      pricing = await confirmVisitPricing(repo, { serviceVisitId: input.serviceVisitId, confirmedBy: `customer:${input.customerId}` });
    } catch {
      throw new InvalidVisitStateError(
        `service_visit ${input.serviceVisitId}'s price increase could not be finalized automatically. Please contact CleanPerfecto for help completing this payment.`
      );
    }
  }

  if (pricing.priceStatus !== "confirmed") {
    throw new InvalidVisitStateError(`service_visit ${input.serviceVisitId} pricing is not confirmed`);
  }

  if (visit.status === "work_finished") {
    // Pricing is frozen (just above) and the physical cleaning already
    // happened — cross scheduled/work_finished -> completed right here, as
    // part of this same customer confirmation, then fall through to the
    // tip/payment steps below in the same call.
    await completeServiceVisit(repo, input.serviceVisitId, `customer:${input.customerId}`);
  } else if (visit.status !== "completed") {
    // The cleaning itself hasn't happened yet (recurring Pay Per Cleaning
    // price increase proposed ahead of the next visit) — approval evidence
    // is captured; nothing is chargeable until it does.
    return { outcome: "approved_awaiting_completion" };
  }

  const { record: payment } = await repo.insertServiceVisitPaymentAttempt({
    serviceVisitId: input.serviceVisitId,
    serviceVisitPricingId: pricing.id,
    approvedAmount: pricing.amountDueFromCustomer,
    idempotencyKey: `visit-payment:${input.serviceVisitId}:v1`,
  });

  if (!payment.tipConfirmedAt) {
    if (!input.tipSelectionType) {
      throw new InvalidVisitStateError("A tip selection is required before payment.");
    }
    await selectVisitTip(repo, gateway, {
      serviceVisitId: input.serviceVisitId,
      tipSelectionType: input.tipSelectionType,
      customAmount: input.customAmount,
    });
  }

  return createVisitPaymentIntent(repo, bookingRepo, gateway, { serviceVisitId: input.serviceVisitId, customerId: input.customerId });
}
