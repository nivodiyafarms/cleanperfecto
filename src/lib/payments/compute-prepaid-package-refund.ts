import { roundToCents } from "@/lib/pricing/money";

export interface PrepaidPackageRefundInput {
  /** The immutable pre-tax principal actually charged at purchase. */
  packageTotalPaid: number;
  /** The immutable Stripe Tax collected at purchase — null for a legacy package purchased before tax was tracked, or one purchased with TAX_MODE disabled. */
  taxAmount: number | null;
  remainingVisitCount: number;
  purchasedVisitCount: number;
}

export interface PrepaidPackageRefundResult {
  refundAmount: number;
  refundTaxAmount: number;
}

/**
 * The single source of truth for the finalized prepaid-package cancellation
 * refund formula — refundable principal/tax = packageTotalPaid|taxAmount ×
 * (remainingVisitCount / purchasedVisitCount), each rounded independently
 * via roundToCents (verified equivalent to pure integer-cent arithmetic at
 * these magnitudes — see refund-prepaid-package.ts's own doc comment).
 * Shared by refund-prepaid-package.ts (the actual, authoritative execution)
 * and the admin package detail page (a preview of that same math, rendered
 * server-side from the identical current persisted facts) so the two can
 * never drift apart — the page never invents its own copy of this formula.
 *
 * Pure and read-only: never mutates anything, never calls Stripe, never
 * touches the database. The admin page's preview is exactly that — a
 * preview computed from whatever package state was current at render time.
 * refundPrepaidPackage() always recomputes this fresh from a just-fetched
 * row at the moment a cancellation is actually submitted, so a credit
 * consumed between page render and button click is reflected in the real
 * refund even though the earlier preview couldn't have known about it.
 */
export function computePrepaidPackageRefund(input: PrepaidPackageRefundInput): PrepaidPackageRefundResult {
  const visitFraction = input.remainingVisitCount / input.purchasedVisitCount;
  const refundAmount = roundToCents(input.packageTotalPaid * visitFraction);
  const refundTaxAmount = input.taxAmount != null ? roundToCents(input.taxAmount * visitFraction) : 0;
  return { refundAmount, refundTaxAmount };
}
