import type { SchedulingRepository } from "@/lib/scheduling/repository";
import type { TaxReversalReconciliationRow } from "@/lib/scheduling/domain-types";
import { toStripeCents } from "@/lib/booking/stripe/money";
import type { VisitPaymentGateway } from "./visit-payment-gateway";

export interface TaxReversalActor {
  actorAdminUserId: string;
  actorRole: string;
}

/**
 * Phase F.1 — the single place that ever calls
 * gateway.reverseTaxTransaction. Used both by the automatic first attempt
 * (immediately after a refund commits — see refund-visit-payment.ts /
 * refund-prepaid-package.ts) and by the admin-triggered manual retry (see
 * retry-tax-reversal.ts), so both paths share identical idempotency and
 * state-transition behavior — there is no separate "first attempt" logic
 * to drift out of sync with "retry" logic.
 *
 * Idempotent: both `reference` and `idempotencyKey` are derived from the
 * reconciliation row's own immutable id, never randomly generated per
 * attempt (that was Phase F's latent gap — a retry with a fresh random
 * key could never be recognized by Stripe as "the same reversal" if the
 * first attempt had actually succeeded server-side but the local write
 * of that success failed). A stable key means: if Stripe already
 * performed this exact reversal on a prior attempt, a later retry gets
 * back the SAME Stripe result instead of double-reversing.
 *
 * Never throws on a Stripe-side failure — that is an expected, retriable
 * outcome, durably recorded via markTaxReversalReconciliationFailed, not
 * an application error. A local database failure (creating/updating the
 * reconciliation row itself) is NOT caught here and propagates — that
 * indicates real trouble, not a transient Stripe issue, and swallowing it
 * would silently defeat the entire point of F.1.
 */
export async function attemptTaxReversal(
  repo: SchedulingRepository,
  gateway: VisitPaymentGateway,
  reconciliation: TaxReversalReconciliationRow,
  actor: TaxReversalActor
): Promise<TaxReversalReconciliationRow> {
  if (reconciliation.status === "succeeded") {
    return reconciliation; // Idempotent no-op — never re-attempts a succeeded reversal.
  }

  try {
    const result = await gateway.reverseTaxTransaction({
      originalTransactionId: reconciliation.originalTransactionId,
      mode: reconciliation.mode,
      refundAmountCents: reconciliation.mode === "partial" ? toStripeCents(reconciliation.intendedAmount) : undefined,
      reference: `tax-reversal-reconciliation:${reconciliation.id}`,
      idempotencyKey: `tax-reversal-reconciliation:${reconciliation.id}`,
    });
    return await repo.markTaxReversalReconciliationSucceeded(reconciliation.id, result.id, actor);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Stripe Tax reversal error";
    console.warn(`[payments] Stripe Tax reversal failed for tax_reversal_reconciliations ${reconciliation.id} (originalTransactionId=${reconciliation.originalTransactionId}): ${message}`);
    return await repo.markTaxReversalReconciliationFailed(reconciliation.id, message);
  }
}
