/**
 * Rounds a monetary amount to the nearest cent (2 decimal places),
 * eliminating IEEE-754 floating-point noise (e.g. 700.008000000001,
 * 440.00000000000006) before rounding. The single source of truth for
 * turning an internal, full-precision calculation into an authoritative,
 * payable USD amount — every pricing module should call this rather than
 * rolling its own `Math.round(value * 100) / 100`.
 *
 * Only apply this at the point a value becomes a final/authoritative
 * output. Do not round intermediate multiplications — round once, at the
 * end, so cent-level error never compounds across a calculation chain.
 */
export function roundToCents(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
