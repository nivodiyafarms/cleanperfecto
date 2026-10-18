import { classifyAddOns } from "@/lib/pricing/add-ons";
import type { SchedulingRepository } from "@/lib/scheduling/repository";
import { InvalidVisitStateError } from "@/lib/scheduling/errors";
import { resolveTipBasisAmount } from "./resolve-tip-basis";
import { previewServiceAmountAndTax } from "./preview-service-amount-and-tax";
import type { VisitPaymentGateway } from "./visit-payment-gateway";

export interface VisitPaymentReviewLineItem {
  description: string;
  /** Positive for an add-on/custom charge, negative for a custom discount/credit — never a separately-signaled boolean, matching how these are already stored on service_visit_pricing.custom_adjustments. */
  amount: number;
}

export interface VisitPaymentReview {
  serviceVisitPaymentId: string;
  approvedAmount: number;
  /**
   * The visit's original, pre-adjustment cleaning price ("Original booking
   * price" on the customer's Final Total) — service_visit_pricing.base_amount,
   * already-available data, never newly seeded/migrated for this purpose.
   * Equal to approvedAmount when nothing was added/adjusted/discounted, in
   * which case the customer-facing UI should skip the Original/Final/
   * Difference comparison entirely (see VisitPaymentFlow.tsx). Note this is
   * the total BEFORE tax — the same authoritative pre-tax amount tax and
   * amountDueFromCustomer are already derived from, never recomputed here.
   */
  baseAmount: number;
  /** Every predefined add-on, custom charge, and custom discount/credit contributing to approvedAmount, in the order they're stored — "customer sees all adjustment line items" (never collapsed into one aggregate figure). Empty when nothing was added/adjusted. */
  lineItems: VisitPaymentReviewLineItem[];
  tipBasisAmount: number;
  /** A non-financial, never-linked, never-persisted-as-final Stripe Tax preview — service/extras only, no tip. Display only. */
  previewTaxAmount: number;
  previewAmountDueBeforeTip: number;
  /** True once the customer has already frozen this payment (via Confirm & Pay or an Admin-recorded external settlement) — Step 1 should not be re-shown as editable. */
  alreadyConfirmed: boolean;
}

/**
 * Step 1 — Review Charges. Creates the service_visit_payments row if one
 * doesn't exist yet (idempotent — insertServiceVisitPaymentAttempt is
 * insert-or-fetch), then builds a display-only Stripe Tax PREVIEW
 * calculation (service/extras only — no tip line, since no tip has been
 * selected yet) that is never linked to a PaymentIntent and never persisted
 * as the row's authoritative stripe_tax_calculation_id.
 */
export async function prepareVisitPaymentReview(repo: SchedulingRepository, gateway: VisitPaymentGateway, serviceVisitId: string): Promise<VisitPaymentReview> {
  const visit = await repo.findServiceVisitById(serviceVisitId);
  if (!visit) {
    throw new InvalidVisitStateError(`service_visit ${serviceVisitId} not found`);
  }
  if (visit.status !== "completed") {
    throw new InvalidVisitStateError(`service_visit ${serviceVisitId} has not completed yet — payment review is only available after completion`);
  }

  const pricing = await repo.findServiceVisitPricingByVisitId(serviceVisitId);
  if (pricing?.priceStatus === "revision_in_progress") {
    // Deliberately no "service_visit " prefix and no raw id embedded here —
    // unlike most InvalidVisitStateError messages in this domain, THIS one
    // is customer-facing (via getVisitPaymentReviewAction's
    // sanitizeVisitStateMessage, which replaces any message starting with
    // "service_visit "/containing a UUID with a generic fallback) as well
    // as admin-facing (via recordCashOrZellePayment's own early check).
    // Embedding either would make the customer version silently collapse
    // to the generic "we couldn't process that" text, defeating the point
    // of writing this specific copy.
    throw new InvalidVisitStateError(
      "This visit's total is currently being revised — check back shortly once the new Final Total is confirmed."
    );
  }
  if (!pricing || pricing.priceStatus !== "confirmed") {
    throw new InvalidVisitStateError(`service_visit ${serviceVisitId} pricing is not confirmed — no payment review is available yet`);
  }

  const tipBasisAmount = await resolveTipBasisAmount(repo, visit, pricing);

  const { record: inserted } = await repo.insertServiceVisitPaymentAttempt({
    serviceVisitId,
    serviceVisitPricingId: pricing.id,
    approvedAmount: pricing.amountDueFromCustomer,
    idempotencyKey: `visit-payment:${serviceVisitId}:v1`,
  });

  // A pre-existing gap, independent of (but newly reachable by) the
  // Revise & Resend feature: this row may have been created (or last
  // resynced) against an OLDER pricing.amountDueFromCustomer — e.g. a scope
  // change, or a revision that finished since. Resync in place while still
  // pre-freeze so the customer/admin always reviews the CURRENT amount, not
  // a stale snapshot.
  const record =
    !inserted.tipConfirmedAt && inserted.approvedAmount !== pricing.amountDueFromCustomer
      ? await repo.resyncServiceVisitPaymentApprovedAmount(inserted.id, pricing.amountDueFromCustomer)
      : inserted;

  const { taxAmount: previewTaxAmount, previewTotal: previewAmountDueBeforeTip } = await previewServiceAmountAndTax(gateway, visit, pricing);

  const lineItems: VisitPaymentReviewLineItem[] = [
    ...classifyAddOns(pricing.addOnIds).priced.map((addOn) => ({ description: addOn.label, amount: addOn.amount })),
    ...pricing.customAdjustments.map((adjustment) => ({
      description: adjustment.description,
      amount: adjustment.type === "custom_discount" ? -adjustment.amount : adjustment.amount,
    })),
  ];

  return {
    serviceVisitPaymentId: record.id,
    approvedAmount: record.approvedAmount,
    baseAmount: pricing.baseAmount,
    lineItems,
    tipBasisAmount,
    previewTaxAmount,
    previewAmountDueBeforeTip,
    alreadyConfirmed: record.tipConfirmedAt !== null,
  };
}
