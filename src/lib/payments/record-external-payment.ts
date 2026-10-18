import type { SchedulingRepository } from "@/lib/scheduling/repository";
import { InvalidVisitStateError } from "@/lib/scheduling/errors";
import { assertCanRecordExternalPayment } from "@/lib/config/payment-capabilities";
import { issueDocumentsForVisitPayment } from "@/lib/invoicing/issue-documents-for-visit-payment";
import type { VisitPaymentGateway } from "./visit-payment-gateway";

export interface RecordExternalPaymentInput {
  serviceVisitId: string;
  paymentMethodType: "zelle" | "cash";
  externalPaymentReference: string | null;
  /** Attributed in the same transaction as the payment settlement itself — see recordExternalServiceVisitPaymentWithAudit. */
  actorAdminUserId: string;
  actorRole: string;
  /**
   * Supplied ONLY by recordCashOrZellePayment (see
   * record-cash-or-zelle-payment.ts) — folded into the same settling
   * UPDATE as a compare-and-swap, so a concurrent tip change or revision
   * start between that caller's own validation and this call can only
   * ever produce a refusal, never a stale amount recorded as paid. Every
   * other caller omits this entirely and gets the exact original,
   * unconditional behavior.
   */
  expectedRevisionNumber?: number;
  expectedTotalAmount?: number;
  expectedTipAmount?: number;
}

/**
 * Admin's "Record External Payment" action — the amount is never
 * admin-entered; only the already-frozen-or-about-to-freeze server-
 * authoritative total is ever recorded. Two-phase by design: the payment
 * fact AND its required financial-audit actor record commit together,
 * atomically, in phase 1 (see recordExternalServiceVisitPaymentWithAudit —
 * either both succeed or neither does, closing a gap where a network
 * hiccup between two separate writes could leave a paid visit with no
 * audit trail); the Stripe Tax transaction commit is attempted afterward,
 * in phase 2, best-effort, and its failure never rolls back or alters the
 * payment fact (see the migration's freeze trigger, which leaves
 * tax_transaction_status mutable post-freeze for exactly this reason).
 */
export async function recordExternalPayment(repo: SchedulingRepository, gateway: VisitPaymentGateway, input: RecordExternalPaymentInput): Promise<void> {
  assertCanRecordExternalPayment();

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

  // Phase 1 — the payment fact AND its financial-audit actor record,
  // atomically. Commits unconditionally (both or neither), regardless of
  // what happens to the tax-transaction attempt below. Also acquires the
  // shared visit_payment_claim advisory lock and (when `cas` fields are
  // supplied — recordCashOrZellePayment only) folds a revision-number +
  // total/tip-amount compare-and-swap into this same atomic write — see
  // the repo method's own doc comment.
  const result = await repo.recordExternalServiceVisitPaymentWithAudit(
    payment.id,
    { paymentMethodType: input.paymentMethodType, externalPaymentReference: input.externalPaymentReference },
    { actorAdminUserId: input.actorAdminUserId, actorRole: input.actorRole },
    { expectedRevisionNumber: input.expectedRevisionNumber, expectedTotalAmount: input.expectedTotalAmount, expectedTipAmount: input.expectedTipAmount }
  );
  if (!result.ok) {
    if (result.reason === "revision_in_progress") {
      throw new InvalidVisitStateError(`service_visit ${input.serviceVisitId}'s total is currently being revised — check back shortly once the new Final Total is confirmed`);
    }
    throw new InvalidVisitStateError("The total changed since you reviewed it — please refresh and recheck the amount.");
  }
  const settled = result.record;

  // Best-effort — issuing the invoice/receipt paperwork must never be
  // mistaken for (or roll back) the payment itself, which already
  // committed above (phase 1).
  await issueDocumentsForVisitPayment(repo, settled).catch((error) => {
    console.error(`[payments] failed to issue invoice/receipt for service_visit_payments ${settled.id}:`, error);
  });

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
