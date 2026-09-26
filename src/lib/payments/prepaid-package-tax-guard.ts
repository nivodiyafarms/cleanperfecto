/**
 * The single source of truth for distinguishing a prepaid package's
 * authoritative-zero Stripe Tax fact from an unknown historical one.
 *
 * `taxAmount === null` means Stripe's Checkout Session tax facts were never
 * recorded for this package — either it was purchased before
 * 20260918100000_add_prepaid_package_tax_accounting.sql existed (a true
 * legacy package), or (per that column's own comment) TAX_MODE was disabled
 * at purchase time. `taxAmount === 0` means Stripe positively reported zero
 * tax was collected — a genuine, authoritative fact, never a guess.
 *
 * These are NOT equivalent. Treating null as 0 would silently under-refund
 * (or over-state, on the display side) a customer whose real historical tax
 * amount this system simply never captured — exactly the failure mode this
 * guard exists to prevent. Automated cancellation/refund must never assume,
 * guess, or recompute historical tax from today's rate for a package this
 * function flags as unknown.
 */
export function hasUnknownHistoricalTax(pkg: { taxAmount?: number | null }): boolean {
  return pkg.taxAmount === null || pkg.taxAmount === undefined;
}

export const LEGACY_PACKAGE_TAX_UNKNOWN_MESSAGE =
  "This legacy package does not contain complete historical tax information. Review the original Stripe transaction before issuing a refund.";
