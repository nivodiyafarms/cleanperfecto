import type { TaxReversalReconciliationRow } from "@/lib/scheduling/domain-types";

export interface VisitTaxReversalStatus {
  /** Reconciliations that still need owner attention (status 'pending' or 'failed') — render one warning+retry block per entry. */
  pendingTaxReversals: TaxReversalReconciliationRow[];
  /** True when at least one reconciliation exists and every one of them has succeeded — render the compact "Tax: Reconciled" line, nothing more. */
  hasSucceededTaxReversal: boolean;
}

/**
 * Pure visibility rule for the admin visit detail page's Tax reconciliation
 * retry UI (owner-admin operational recovery for the per-visit custom
 * PaymentIntent + Stripe Tax refund flow only — see refund-visit-payment.ts
 * / attempt-tax-reversal.ts).
 *
 * Deliberately takes just the reconciliation list, not the visit/payment —
 * every exclusion this UI needs (normal paid visits, refunds with a
 * successful reversal, transactions with no Stripe Tax transaction,
 * external cash/Zelle payments, prepaid-package Checkout automatic_tax
 * refunds) already falls out of one fact: a tax_reversal_reconciliations
 * row is only ever created by refund-visit-payment.ts, and only when the
 * original payment had a committed Stripe Tax transaction to reverse.
 * Every excluded case above simply never has a row to begin with, so an
 * empty `reconciliations` array here is both the input and the correct
 * "render nothing" outcome — no extra entity-type/payment-method branching
 * is needed in this function or its caller.
 */
export function computeVisitTaxReversalStatus(reconciliations: TaxReversalReconciliationRow[]): VisitTaxReversalStatus {
  const pendingTaxReversals = reconciliations.filter((r) => r.status !== "succeeded");
  const hasSucceededTaxReversal = reconciliations.some((r) => r.status === "succeeded");
  return { pendingTaxReversals, hasSucceededTaxReversal };
}
