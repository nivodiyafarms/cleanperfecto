/**
 * Stripe's canonical tax code for a voluntary gratuity line item, as
 * documented by Stripe Tax's product tax code catalog. Paired with
 * RESIDENTIAL_CLEANING_TAX_CODE (src/lib/booking/stripe/checkout-sessions.ts,
 * reused here rather than duplicated) on the two positive line items of a
 * Payments V1 Tax Calculation — see build-tax-calculation-line-items.ts.
 * Stripe Tax alone determines the jurisdictional tax treatment of this code;
 * nothing in this codebase decides whether/how a tip is taxed.
 */
export const OPTIONAL_GRATUITY_TAX_CODE = "txcd_90020001";
