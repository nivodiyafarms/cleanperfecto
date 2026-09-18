import { randomUUID } from "node:crypto";
import type { SchedulingRepository } from "@/lib/scheduling/repository";
import type { BookingRepository } from "@/lib/booking/repository";
import type { PrepaidPackageRow } from "@/lib/scheduling/domain-types";
import { InvalidVisitStateError } from "@/lib/scheduling/errors";
import { roundToCents } from "@/lib/pricing/money";
import { toStripeCents } from "@/lib/booking/stripe/money";
import { attemptTaxReversal } from "./attempt-tax-reversal";
import type { VisitPaymentGateway } from "./visit-payment-gateway";

export interface RefundPrepaidPackageInput {
  prepaidPackageId: string;
  reason: string;
  actorAdminUserId: string;
  actorRole: string;
}

export interface RefundPrepaidPackageResult {
  package: PrepaidPackageRow;
  refundAmount: number;
}

/**
 * Owner-controlled prepaid-package cancellation refund — RBAC (requireAdmin
 * + assertCapability("issue_refund")) is the CALLER's responsibility, same
 * layering as refund-visit-payment.ts.
 *
 * Finalized business policy (owner-approved): refundable package principal
 * = packageTotalPaid × (remainingVisitCount / purchasedVisitCount),
 * computed from the immutable original package_total_paid snapshot — never
 * a current-price recalculation. Completed visits are never retroactively
 * repriced; they simply reduce remainingVisitCount, which this formula
 * already reflects. Tips, separately-paid add-ons/travel/supplies, and any
 * other per-visit charge were never part of package_total_paid to begin
 * with, so they are excluded automatically by this formula, not by a
 * separate deduction step. Rounded exactly once, at the end (roundToCents),
 * matching this codebase's pricing-engine convention — never rounding the
 * intermediate fraction.
 *
 * A separately assessed service-visit cancellation fee (service_fee_assessments)
 * is never netted against this refund — package cancellation itself
 * creates no new penalty, and any existing fee assessment remains its own
 * independent financial fact (see the finalized policy).
 *
 * remainingVisitCount === 0 (all purchased visits already completed) is a
 * valid, expected case: the computed refund is exactly 0, no Stripe refund
 * or tax reversal is attempted, but the package is still marked cancelled
 * (with refundedAmount = 0) via the same atomic RPC, so there is exactly
 * one consistent audit trail for every cancellation regardless of amount.
 */
export async function refundPrepaidPackage(
  schedulingRepo: SchedulingRepository,
  bookingRepo: BookingRepository,
  gateway: VisitPaymentGateway,
  input: RefundPrepaidPackageInput
): Promise<RefundPrepaidPackageResult> {
  const pkg = await schedulingRepo.findPrepaidPackageById(input.prepaidPackageId);
  if (!pkg) {
    throw new InvalidVisitStateError(`prepaid_packages ${input.prepaidPackageId} not found`);
  }
  if (pkg.status !== "active") {
    throw new InvalidVisitStateError(`prepaid_packages ${pkg.id} is not eligible for cancellation (current status: ${pkg.status})`);
  }
  if (pkg.packageTotalPaid === undefined) {
    throw new InvalidVisitStateError(`prepaid_packages ${pkg.id} has no recorded packageTotalPaid — cannot compute a refund.`);
  }

  const refundAmount = roundToCents(pkg.packageTotalPaid * (pkg.remainingVisitCount / pkg.purchasedVisitCount));
  const isFullPackageRefund = pkg.remainingVisitCount === pkg.purchasedVisitCount;

  let stripeRefundId: string | null = null;
  let stripePaymentIntentId: string | null = null;

  if (refundAmount > 0) {
    const paymentAttempt = await bookingRepo.findCompletedPaymentAttemptForBookingOrder(pkg.bookingOrderId);
    if (!paymentAttempt || !paymentAttempt.stripePaymentIntentId) {
      throw new InvalidVisitStateError(`prepaid_packages ${pkg.id} has no completed Stripe payment on file — cannot issue a refund.`);
    }
    stripePaymentIntentId = paymentAttempt.stripePaymentIntentId;

    const refund = await gateway.createRefund({
      stripePaymentIntentId,
      amountCents: toStripeCents(refundAmount),
      idempotencyKey: `refund:${randomUUID()}`,
    });
    stripeRefundId = refund.id;
  }

  const updated = await schedulingRepo.cancelPrepaidPackageWithRefundAudit(
    pkg.id,
    { refundAmount, stripeRefundId, reason: input.reason },
    { actorAdminUserId: input.actorAdminUserId, actorRole: input.actorRole }
  );

  // Phase F / F.1 — Stripe Tax reversal: never rolls back the already-
  // committed cancellation/refund on failure, deterministically skipped
  // (not an error) when there is nothing to reverse. When a reversal IS
  // owed, intent to reverse is durably persisted BEFORE the Stripe call
  // is attempted — see attempt-tax-reversal.ts.
  //
  // findTaxAssociation itself can throw — confirmed against real Stripe
  // TEST mode: a prepaid package's PaymentIntent is created by a Checkout
  // Session with automatic_tax (create-prepaid-package-checkout.ts), which
  // never wires the PaymentIntent to a standalone Tax Calculation via
  // hooks.inputs.tax.calculation (that path is only used by the per-visit
  // flow, createPaymentIntent). Stripe's Tax Association API only serves
  // that latter integration, so it reports "no associated tax calculation"
  // for every Checkout-originated PaymentIntent, even one that genuinely
  // collected Stripe Tax. This must never crash an already-committed
  // refund/cancellation — mirrors the same try/catch already used for this
  // exact lookup in process-stripe-webhook-event.ts's finalizeVerifiedPayment.
  if (refundAmount > 0 && stripePaymentIntentId) {
    try {
      const taxAssociation = await gateway.findTaxAssociation(stripePaymentIntentId);
      if (taxAssociation?.committedTransactionId) {
        const reconciliation = await schedulingRepo.createTaxReversalReconciliation({
          targetEntityType: "prepaid_package",
          targetEntityId: updated.id,
          originalTransactionId: taxAssociation.committedTransactionId,
          intendedAmount: refundAmount,
          mode: isFullPackageRefund ? "full" : "partial",
        });
        await attemptTaxReversal(schedulingRepo, gateway, reconciliation, { actorAdminUserId: input.actorAdminUserId, actorRole: input.actorRole });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown Stripe Tax association lookup error";
      console.error(`[payments] failed to look up Stripe Tax association for prepaid_packages ${pkg.id} refund (paymentIntent=${stripePaymentIntentId}): ${message}`);
    }
  }

  return { package: updated, refundAmount };
}
