import type { SchedulingRepository } from "@/lib/scheduling/repository";
import { InvalidVisitStateError } from "@/lib/scheduling/errors";
import type { VisitPaymentGateway } from "./visit-payment-gateway";

export interface RecordExternalPaymentInput {
  serviceVisitId: string;
  paymentMethodType: "zelle" | "cash";
  externalPaymentReference: string | null;
}

/**
 * Admin's "Record External Payment" action — the amount is never
 * admin-entered; only the already-frozen-or-about-to-freeze server-
 * authoritative total is ever recorded. Two-phase by design: the DB
 * payment fact commits first and unconditionally; the Stripe Tax
 * transaction commit is attempted afterward, best-effort, and its failure
 * never rolls back or alters the payment fact (see the migration's freeze
 * trigger, which leaves tax_transaction_status mutable post-freeze for
 * exactly this reason).
 */
export async function recordExternalPayment(repo: SchedulingRepository, gateway: VisitPaymentGateway, input: RecordExternalPaymentInput): Promise<void> {
  const payment = await repo.findServiceVisitPaymentByVisitId(input.serviceVisitId);
  if (!payment) {
    throw new InvalidVisitStateError(`service_visit ${input.serviceVisitId} has no payment review yet`);
  }
  if (!payment.tipSelectionType) {
    throw new InvalidVisitStateError("The customer must select a tip before an external payment can be recorded.");
  }
  if (payment.status !== "created") {
    throw new InvalidVisitStateError(`service_visit_payments ${payment.id} is not eligible for external settlement (current status: ${payment.status})`);
  }

  // Phase 1 — the payment fact. Commits unconditionally, regardless of
  // what happens to the tax-transaction attempt below.
  const settled = await repo.recordExternalServiceVisitPayment(payment.id, {
    paymentMethodType: input.paymentMethodType,
    externalPaymentReference: input.externalPaymentReference,
  });
  await repo.updateServiceVisitPricingPaymentStatus(settled.serviceVisitId, "paid");

  // Phase 2 — best-effort tax-transaction commit. A failure here leaves the
  // payment PAID and only marks tax_transaction_status='failed' for later
  // retry (see retry-external-tax-sync.ts) — never reverses phase 1.
  if (!settled.stripeTaxCalculationId) {
    return; // Nothing collectible was ever taxed (shouldn't normally reach here — a $0 total takes the no_payment_due path instead — but fail safe rather than throw).
  }

  try {
    const transaction = await gateway.createTaxTransactionFromCalculation({
      calculationId: settled.stripeTaxCalculationId,
      reference: settled.id,
      idempotencyKey: `tax-transaction:${settled.id}`,
    });
    await repo.updateServiceVisitPaymentTaxSync(settled.id, { taxTransactionStatus: "committed", stripeTaxTransactionId: transaction.id });
  } catch (error) {
    await repo.updateServiceVisitPaymentTaxSync(settled.id, {
      taxTransactionStatus: "failed",
      taxTransactionFailureMessage: error instanceof Error ? error.message : "Unknown Stripe Tax transaction error",
    });
  }
}
