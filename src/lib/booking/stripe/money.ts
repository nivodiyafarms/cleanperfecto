/**
 * Converts a dollar amount (already cent-precise — see roundToCents in
 * src/lib/pricing/money.ts, which every pricing-engine output already
 * passed through) into Stripe's integer smallest-unit (cents) format.
 * `unit_amount` must be an exact integer; naive `amount * 100` can land on
 * e.g. 70000.99999999999 for some inputs due to IEEE-754 float error, so
 * this always rounds after multiplying rather than truncating.
 */
export function toStripeCents(amountDollars: number): number {
  return Math.round(amountDollars * 100);
}
