import type { SchedulingRepository } from "@/lib/scheduling/repository";
import type { TaxReversalReconciliationRow } from "@/lib/scheduling/domain-types";
import { InvalidVisitStateError } from "@/lib/scheduling/errors";
import { attemptTaxReversal, type TaxReversalActor } from "./attempt-tax-reversal";
import type { VisitPaymentGateway } from "./visit-payment-gateway";

export interface RetryTaxReversalInput extends TaxReversalActor {
  reconciliationId: string;
}

/**
 * Admin "Retry Tax Reversal" — owner-gated (RBAC is the CALLER's
 * responsibility, see src/lib/admin/actions/payment-actions.ts), reused
 * capability with issue_refund since this action exists entirely to
 * finish reconciling an already-issued refund's Stripe Tax bookkeeping.
 *
 * Delegates to attemptTaxReversal — the exact same idempotent logic the
 * automatic first attempt uses — so a manual retry can never behave
 * differently from (or double-reverse relative to) the original attempt.
 */
export async function retryTaxReversal(repo: SchedulingRepository, gateway: VisitPaymentGateway, input: RetryTaxReversalInput): Promise<TaxReversalReconciliationRow> {
  const reconciliation = await repo.findTaxReversalReconciliationById(input.reconciliationId);
  if (!reconciliation) {
    throw new InvalidVisitStateError(`tax_reversal_reconciliations ${input.reconciliationId} not found`);
  }

  return attemptTaxReversal(repo, gateway, reconciliation, { actorAdminUserId: input.actorAdminUserId, actorRole: input.actorRole });
}
