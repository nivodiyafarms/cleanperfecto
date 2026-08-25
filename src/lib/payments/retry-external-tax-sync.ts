import type { SchedulingRepository } from "@/lib/scheduling/repository";
import { InvalidVisitStateError } from "@/lib/scheduling/errors";
import { toStripeCents } from "@/lib/booking/stripe/money";
import { reconcileStripeCardTaxAssociation } from "./reconcile-visit-payment";
import { resolveTaxLocationAddress } from "./resolve-tax-location";
import type { VisitPaymentGateway } from "./visit-payment-gateway";

/**
 * Admin "Retry Tax Sync" — the ONLY action this milestone offers for a
 * failed/pending tax-transaction commit. Never touches the payment fact
 * (status/paidAt/tip/tax/total) — those are frozen and this function has no
 * write path to them at all. Refuses outright unless the row is already
 * 'paid' and tax_transaction_status is 'pending' or 'failed', so it can
 * never be used to re-record or duplicate a payment.
 */
export async function retryExternalTaxSync(repo: SchedulingRepository, gateway: VisitPaymentGateway, serviceVisitPaymentId: string): Promise<void> {
  const payment = await repo.findServiceVisitPaymentById(serviceVisitPaymentId);
  if (!payment) {
    throw new InvalidVisitStateError(`service_visit_payments ${serviceVisitPaymentId} not found`);
  }
  if (payment.status !== "paid") {
    throw new InvalidVisitStateError(`service_visit_payments ${serviceVisitPaymentId} is not paid — nothing to sync`);
  }
  if (payment.taxTransactionStatus === "committed") {
    return; // Already committed — idempotent no-op, never re-commits.
  }
  if (payment.taxTransactionStatus === "not_applicable") {
    throw new InvalidVisitStateError(`service_visit_payments ${serviceVisitPaymentId} has no tax transaction to sync`);
  }

  if (payment.paymentMethodType === "stripe_card") {
    if (!payment.stripePaymentIntentId) {
      throw new InvalidVisitStateError(`service_visit_payments ${serviceVisitPaymentId} has no PaymentIntent to reconcile against`);
    }
    await reconcileStripeCardTaxAssociation(repo, gateway, payment.id, payment.stripePaymentIntentId);
    return;
  }

  // zelle / cash — the one legitimate manual createFromCalculation path.
  if (!payment.stripeTaxCalculationId) {
    throw new InvalidVisitStateError(`service_visit_payments ${serviceVisitPaymentId} has no Tax Calculation to sync from`);
  }

  const idempotencyKey = `tax-transaction:${payment.id}`;
  const stillValid = payment.taxCalculationExpiresAt && payment.taxCalculationExpiresAt.getTime() > Date.now();

  let calculationIdToCommit = payment.stripeTaxCalculationId;

  if (!stillValid) {
    // Expired — recreate from the FROZEN evidence only, and verify the
    // fresh total reconciles exactly to what was already recorded as paid
    // before ever attempting to commit it. A mismatch means jurisdiction/
    // rate data changed since the original calculation — never silently
    // reconciled; fail closed and leave it for manual review.
    const visit = await repo.findServiceVisitById(payment.serviceVisitId);
    if (!visit) {
      throw new InvalidVisitStateError(`service_visit ${payment.serviceVisitId} not found while refreshing an expired Tax Calculation`);
    }
    const address = resolveTaxLocationAddress(visit);
    const fresh = await gateway.createTaxCalculation({
      serviceAmountCents: toStripeCents(payment.approvedAmount),
      tipAmountCents: toStripeCents(payment.tipAmount ?? 0),
      address,
    });

    const frozenTotalCents = toStripeCents(payment.totalAmount ?? 0);
    if (fresh.amountTotalCents !== frozenTotalCents) {
      await repo.updateServiceVisitPaymentTaxSync(payment.id, {
        taxTransactionStatus: "failed",
        taxTransactionFailureMessage: `Recreated tax calculation total ($${(fresh.amountTotalCents / 100).toFixed(2)}) does not match the recorded paid total ($${(payment.totalAmount ?? 0).toFixed(2)}) — manual reconciliation required. The paid amount was NOT changed.`,
      });
      return;
    }

    await repo.updateServiceVisitPaymentTaxSync(payment.id, {
      taxTransactionStatus: "pending",
      stripeTaxCalculationId: fresh.id,
      taxCalculationExpiresAt: fresh.expiresAt,
    });
    calculationIdToCommit = fresh.id;
  }

  try {
    const transaction = await gateway.createTaxTransactionFromCalculation({ calculationId: calculationIdToCommit, reference: payment.id, idempotencyKey });
    await repo.updateServiceVisitPaymentTaxSync(payment.id, { taxTransactionStatus: "committed", stripeTaxTransactionId: transaction.id });
  } catch (error) {
    await repo.updateServiceVisitPaymentTaxSync(payment.id, {
      taxTransactionStatus: "failed",
      taxTransactionFailureMessage: error instanceof Error ? error.message : "Unknown Stripe Tax transaction error",
    });
  }
}
