import "server-only";

import { roundToCents } from "@/lib/pricing/money";

/** Owner-approved 2026-08-19: an extra 1% savings for choosing ACH (bank account) over card on a 6+ prepaid package. A payment-method incentive, not a pricing-engine rule — applied on top of the already-discounted, trusted prepaidPackageTotal, never inside calculate-estimate.ts. */
export const ACH_SAVINGS_RATE = 0.01;

export interface AchIncentiveResult {
  achSubtotal: number;
  achSavingsAmount: number;
}

/**
 * Applies the ACH payment-method incentive to an already-trusted,
 * already-discounted prepaid package subtotal (never recomputed, never
 * invented). Rounds once via the same centralized roundToCents the pricing
 * engine uses — never a second, ad hoc rounding rule.
 */
export function applyAchIncentive(cardSubtotal: number): AchIncentiveResult {
  const achSubtotal = roundToCents(cardSubtotal * (1 - ACH_SAVINGS_RATE));
  const achSavingsAmount = roundToCents(cardSubtotal - achSubtotal);
  return { achSubtotal, achSavingsAmount };
}
