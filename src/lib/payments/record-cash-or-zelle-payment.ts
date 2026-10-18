import { roundToCents } from "@/lib/pricing/money";
import type { SchedulingRepository } from "@/lib/scheduling/repository";
import { InvalidVisitStateError } from "@/lib/scheduling/errors";
import { prepareVisitPaymentReview } from "./prepare-visit-payment-review";
import { recordExternalPayment } from "./record-external-payment";
import { selectVisitTip } from "./select-visit-tip";
import type { VisitPaymentGateway } from "./visit-payment-gateway";

export interface RecordCashOrZellePaymentInput {
  serviceVisitId: string;
  paymentMethodType: "cash" | "zelle";
  /** The admin's own typed tip figure — never a hardcoded 0, never auto-confirmed. Passed through to selectVisitTip exactly as a customer's custom tip amount already is. */
  tipAmount: number;
  /** The admin's double-entry confirmation of the total actually received — validated against the authoritative (service + tax + tip) total, never trusted on its own. */
  totalReceivedConfirmation: number;
  externalPaymentReference: string | null;
  actorAdminUserId: string;
  actorRole: string;
}

/**
 * Admin's direct, self-contained "Record Cash/Zelle Payment Received" flow
 * — never dependent on the customer ever visiting /my/payments, and never
 * silently choosing a tip on anyone's behalf. Opening the admin form is a
 * read-only preview (see preview-service-amount-and-tax.ts); THIS function
 * is the submit step, and is the only place any of this is written.
 *
 * Sequencing, reusing every existing audited piece unmodified:
 *   1. Load pricing; refuse unless priceStatus === 'confirmed' (covers
 *      both "not yet finalized" and "a revision is active" — the same
 *      guard condition Feature 2 introduced). Capture revisionNumber here
 *      as the pricing-version anchor carried through to the atomic settle
 *      step below.
 *   2. prepareVisitPaymentReview — idempotent create-or-fetch. Refuse
 *      early (friendly fast-fail, not the authoritative guarantee — see
 *      step 5) if the row isn't status='created'.
 *   3. selectVisitTip with the admin's own typed tip amount — computes
 *      and persists the authoritative tax/total (a real Stripe Tax
 *      Calculation), not yet frozen.
 *   4. Validate totalReceivedConfirmation against the authoritative
 *      total/tip just computed — a mismatch refuses with the expected
 *      breakdown, recording nothing.
 *   5. recordExternalPayment, carrying the captured revisionNumber/total/
 *      tip as a compare-and-swap folded into the one atomic settling
 *      write — a concurrent tip change or revision start between steps
 *      3/4 and 5 can only ever produce a refusal, never a stale amount
 *      recorded as paid.
 */
export async function recordCashOrZellePayment(repo: SchedulingRepository, gateway: VisitPaymentGateway, input: RecordCashOrZellePaymentInput): Promise<void> {
  if (!Number.isFinite(input.tipAmount) || input.tipAmount < 0) {
    throw new InvalidVisitStateError("Tip amount must be zero or a positive number.");
  }
  if (!Number.isFinite(input.totalReceivedConfirmation) || input.totalReceivedConfirmation < 0) {
    throw new InvalidVisitStateError("Enter a valid total received amount.");
  }

  const pricing = await repo.findServiceVisitPricingByVisitId(input.serviceVisitId);
  if (pricing?.priceStatus === "revision_in_progress") {
    throw new InvalidVisitStateError(
      `service_visit ${input.serviceVisitId}'s total is currently being revised — check back shortly once the new Final Total is confirmed`
    );
  }
  if (!pricing || pricing.priceStatus !== "confirmed") {
    throw new InvalidVisitStateError(`service_visit ${input.serviceVisitId} pricing is not confirmed — nothing to record a payment against yet`);
  }
  const expectedRevisionNumber = pricing.revisionNumber;

  await prepareVisitPaymentReview(repo, gateway, input.serviceVisitId);
  const payment = await repo.findServiceVisitPaymentByVisitId(input.serviceVisitId);
  if (!payment) {
    throw new InvalidVisitStateError(`service_visit ${input.serviceVisitId} has no payment review yet`);
  }
  if (payment.status !== "created") {
    throw new InvalidVisitStateError("A payment is already recorded or in progress for this visit.");
  }

  const tipResult = await selectVisitTip(repo, gateway, {
    serviceVisitId: input.serviceVisitId,
    tipSelectionType: "custom",
    customAmount: input.tipAmount,
  });

  const expectedTotalAmount = roundToCents(tipResult.totalAmount);
  const expectedTipAmount = roundToCents(tipResult.tipAmount);
  if (roundToCents(input.totalReceivedConfirmation) !== expectedTotalAmount) {
    throw new InvalidVisitStateError(
      `The amount entered ($${input.totalReceivedConfirmation.toFixed(2)}) doesn't match the expected total — ` +
        `service/extras $${tipResult.approvedAmount.toFixed(2)} + tax $${tipResult.taxAmount.toFixed(2)} + tip $${expectedTipAmount.toFixed(2)} = $${expectedTotalAmount.toFixed(2)}. ` +
        `Please recheck the amount.`
    );
  }

  await recordExternalPayment(repo, gateway, {
    serviceVisitId: input.serviceVisitId,
    paymentMethodType: input.paymentMethodType,
    externalPaymentReference: input.externalPaymentReference,
    actorAdminUserId: input.actorAdminUserId,
    actorRole: input.actorRole,
    expectedRevisionNumber,
    expectedTotalAmount,
    expectedTipAmount,
  });
}
