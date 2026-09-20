import { randomUUID } from "node:crypto";
import type { SchedulingRepository } from "@/lib/scheduling/repository";
import type { BookingRepository } from "@/lib/booking/repository";
import type { PrepaidPackageRow } from "@/lib/scheduling/domain-types";
import { InvalidVisitStateError } from "@/lib/scheduling/errors";
import { roundToCents } from "@/lib/pricing/money";
import { toStripeCents } from "@/lib/booking/stripe/money";
import { computePrepaidPackageRefund } from "./compute-prepaid-package-refund";
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
  refundTaxAmount: number;
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
 * separate deduction step.
 *
 * Phase H.2 (owner-directed tax-refund investigation, this milestone):
 * refundTaxAmount = taxAmount × (remainingVisitCount / purchasedVisitCount)
 * — the SAME proportion as the principal, computed and rounded completely
 * independently (never derived from refundAmount, never combined with it
 * before rounding). Both are rounded via roundToCents — verified equivalent
 * to pure integer-cent arithmetic at these magnitudes (e.g. 63.58×5/6 in
 * cents: round(31790/6)=5298 — identical to roundToCents(63.58×5/6)=52.98).
 * The two amounts are then converted to integer cents independently
 * (toStripeCents) and summed as integers — never as floats — before being
 * sent to Stripe as ONE combined refund, avoiding the float noise a direct
 * dollar-sum would reintroduce (642.19 + 52.98 !== 695.17 in IEEE-754).
 * taxAmount is null for a legacy package purchased before this fix existed,
 * or one purchased with TAX_MODE disabled — refundTaxAmount is exactly 0 in
 * that case, never invented.
 *
 * Real Stripe TEST mode investigation (this milestone) established that a
 * prepaid package's PaymentIntent — created by a Checkout Session with
 * automatic_tax (create-prepaid-package-checkout.ts) — is NEVER wired to a
 * standalone Tax Calculation the way the per-visit flow's PaymentIntents
 * are (createPaymentIntent's hooks.inputs.tax.calculation). Per Stripe's
 * own Tax reporting docs (docs.stripe.com/tax/reports), creating an
 * ordinary refund against a Checkout-Session-originated charge is, on its
 * own, one of the operations that decreases Stripe's reported tax balance
 * for that transaction — listed as independent from, not dependent on,
 * calling the Tax Transactions API's createReversal. There is therefore
 * nothing left for this function to do beyond issuing that one combined
 * refund: no findTaxAssociation lookup (confirmed, twice, against real
 * Checkout-originated PaymentIntents, to always fail with "no associated
 * tax calculation" — there is nothing to find), and certainly no
 * createReversal call, which would either fail for the same reason or, far
 * worse, double-reverse tax Stripe has already adjusted via the refund
 * itself. (The per-visit flow's own reversal path — refund-visit-payment.ts,
 * attempt-tax-reversal.ts — is untouched by this change; it uses the other,
 * manual PaymentIntent+Tax-Calculation integration, where a reversal really
 * must be created explicitly.)
 *
 * A separately assessed service-visit cancellation fee (service_fee_assessments)
 * is never netted against this refund — package cancellation itself
 * creates no new penalty, and any existing fee assessment remains its own
 * independent financial fact (see the finalized policy).
 *
 * remainingVisitCount === 0 (all purchased visits already completed) is a
 * valid, expected case: both computed refund amounts are exactly 0, no
 * Stripe refund is attempted, but the package is still marked cancelled
 * (with refundedAmount = refundedTaxAmount = 0) via the same atomic RPC, so
 * there is exactly one consistent audit trail for every cancellation
 * regardless of amount.
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

  const { refundAmount, refundTaxAmount } = computePrepaidPackageRefund({
    packageTotalPaid: pkg.packageTotalPaid,
    taxAmount: pkg.taxAmount ?? null,
    remainingVisitCount: pkg.remainingVisitCount,
    purchasedVisitCount: pkg.purchasedVisitCount,
  });
  const stripeRefundAmountCents = toStripeCents(refundAmount) + toStripeCents(refundTaxAmount);

  let stripeRefundId: string | null = null;
  let totalRefundAmount: number | null = null;

  if (stripeRefundAmountCents > 0) {
    const paymentAttempt = await bookingRepo.findCompletedPaymentAttemptForBookingOrder(pkg.bookingOrderId);
    if (!paymentAttempt || !paymentAttempt.stripePaymentIntentId) {
      throw new InvalidVisitStateError(`prepaid_packages ${pkg.id} has no completed Stripe payment on file — cannot issue a refund.`);
    }

    const refund = await gateway.createRefund({
      stripePaymentIntentId: paymentAttempt.stripePaymentIntentId,
      amountCents: stripeRefundAmountCents,
      idempotencyKey: `refund:${randomUUID()}`,
    });
    stripeRefundId = refund.id;
    totalRefundAmount = roundToCents(refund.amountCents / 100);
  }

  const updated = await schedulingRepo.cancelPrepaidPackageWithRefundAudit(
    pkg.id,
    { refundAmount, refundTaxAmount, totalRefundAmount, stripeRefundId, reason: input.reason },
    { actorAdminUserId: input.actorAdminUserId, actorRole: input.actorRole }
  );

  return { package: updated, refundAmount, refundTaxAmount };
}
