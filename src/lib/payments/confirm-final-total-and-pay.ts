import type { BookingRepository } from "@/lib/booking/repository";
import type { SchedulingRepository } from "@/lib/scheduling/repository";
import type { TipSelectionType } from "@/lib/scheduling/types";
import { InvalidVisitStateError } from "@/lib/scheduling/errors";
import { completeServiceVisit } from "@/lib/scheduling/complete-service-visit";
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
 * The customer's ONE "Confirm Final Total & Pay" click. Reuses the existing
 * pricing/payment state machine verbatim (selectVisitTip,
 * createVisitPaymentIntent) — no new tables, no relaxed triggers, no
 * invented totals. The server, never the client, decides what "the final
 * total" actually is at every step.
 *
 * Pay Per Cleaning no longer has a separate customer price-change approval
 * step (owner-approved product decision, 2026-09-26 — see
 * estimate-visit-pricing.ts's own doc comment): by the time a visit's
 * pricing reaches price_status='confirmed', Finalize & Send has already
 * frozen it unconditionally, whatever the final amount is. This call
 * requires pricing to already be 'confirmed' — never resolves an approval
 * gate itself, because that gate no longer exists.
 *
 * If the visit is 'work_finished' (physical work is done; pricing is
 * already confirmed above), THIS call also crosses the completion boundary
 * right here — only after pricing is frozen — so the customer's one click
 * is immediately followed by tip/payment, with no separate "wait for admin"
 * round trip. This remains relevant for a visit whose pricing was confirmed
 * ahead of the cleaning itself (confirmVisitPricingAction, used for a
 * recurring Pay Per Cleaning visit) but hasn't been marked work-finished/
 * completed yet: if the visit hasn't even been cleaned yet (still
 * 'requested'/'scheduled'), this returns "approved_awaiting_completion" —
 * there is genuinely nothing to charge yet.
 *
 * Every step here is idempotent-safe to retry: confirmServiceVisitPricing is
 * re-callable, insertServiceVisitPaymentAttempt is insert-or-fetch,
 * selectVisitTip is freely re-callable pre-freeze, and
 * createVisitPaymentIntent reuses (never duplicates) an existing
 * PaymentIntent for this row. A failure before a charge leaves the visit in
 * a fully recoverable state — the next call picks up exactly where this one
 * left off.
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

  const pricing = await repo.findServiceVisitPricingByVisitId(input.serviceVisitId);
  if (!pricing) {
    throw new InvalidVisitStateError(`service_visit ${input.serviceVisitId} has no pricing estimate yet`);
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
    // The cleaning itself hasn't happened yet (pricing was confirmed ahead
    // of a recurring Pay Per Cleaning visit, via confirmVisitPricingAction)
    // — nothing is chargeable until it does.
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
