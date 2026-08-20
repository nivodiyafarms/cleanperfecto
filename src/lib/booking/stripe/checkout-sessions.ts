import "server-only";

import type Stripe from "stripe";
import { toStripeCents } from "./money";

/**
 * Stripe's canonical tax code for residential cleaning services, as
 * supplied and verified by the product owner. Never invented/guessed here
 * — see the "Do not go live until" checklist for the go-live spot-check
 * against the Tax Codes API before real charges.
 */
export const RESIDENTIAL_CLEANING_TAX_CODE = "txcd_20010006";

export interface CreateSetupCheckoutSessionParams {
  stripeCustomerId: string;
  bookingOrderId: string;
  successUrl: string;
  cancelUrl: string;
  /** Fresh per attempt — protects only this one create-call from a network-level double-fire, never a stand-in for cross-attempt dedup (that's the booking_orders.client_request_id + "is there still an open attempt" checks). */
  idempotencyKey: string;
}

/**
 * Securely saves a payment method against the Stripe Customer, with no
 * charge. `payment_method_types` is intentionally omitted (never hardcode
 * it) so Stripe's dynamic payment methods apply, managed from the
 * Dashboard rather than this code.
 */
export async function createSetupCheckoutSession(
  stripe: Stripe,
  params: CreateSetupCheckoutSessionParams
): Promise<Stripe.Checkout.Session> {
  return stripe.checkout.sessions.create(
    {
      mode: "setup",
      currency: "usd",
      customer: params.stripeCustomerId,
      success_url: params.successUrl,
      cancel_url: params.cancelUrl,
      metadata: { booking_order_id: params.bookingOrderId },
    },
    { idempotencyKey: params.idempotencyKey }
  );
}

export interface CreatePrepaidCheckoutSessionParams {
  stripeCustomerId: string;
  bookingOrderId: string;
  /** The exact server-calculated subtotal in dollars (pre-tax) for the selected payment method — Stripe Tax adds the tax line at Checkout; this code never computes or hardcodes a tax amount or rate. For the ACH path, this is already the ACH-incentive-discounted amount (see ach-incentive.ts) — never the card amount. */
  packageSubtotal: number;
  productName: string;
  successUrl: string;
  cancelUrl: string;
  idempotencyKey: string;
}

/**
 * Charges the full server-calculated package amount by card, with Stripe
 * Tax enabled. The line item uses inline `price_data` (never a pre-created
 * fixed Stripe Price, since the amount is quote-specific) tagged with the
 * residential-cleaning tax code so Stripe Tax classifies it correctly.
 * `automatic_tax.enabled: true` calculates tax from the Stripe Customer's
 * address (already synced — see resolveStripeCustomerId) with NO
 * hardcoded percentage anywhere in this codebase. If CleanPerfecto has no
 * active Stripe Tax registration for the customer's jurisdiction, Stripe
 * calculates and collects zero tax with no error — see the "Do not go
 * live until" checklist; this is not something this code can detect.
 *
 * `payment_method_types` is explicitly restricted to `["card"]` here — a
 * deliberate, narrow exception to this file's usual "never hardcode
 * payment_method_types" rule. Card and ACH now have two different prices
 * for the same package (see ach-incentive.ts), so this session must not be
 * able to silently settle via a cheaper payment method than the one the
 * customer actually chose and that this exact amount was calculated for.
 */
export async function createPrepaidCardCheckoutSession(
  stripe: Stripe,
  params: CreatePrepaidCheckoutSessionParams
): Promise<Stripe.Checkout.Session> {
  return stripe.checkout.sessions.create(
    {
      mode: "payment",
      payment_method_types: ["card"],
      customer: params.stripeCustomerId,
      automatic_tax: { enabled: true },
      line_items: [
        {
          price_data: {
            currency: "usd",
            unit_amount: toStripeCents(params.packageSubtotal),
            product_data: {
              name: params.productName,
              tax_code: RESIDENTIAL_CLEANING_TAX_CODE,
            },
          },
          quantity: 1,
        },
      ],
      payment_intent_data: { metadata: { booking_order_id: params.bookingOrderId } },
      success_url: params.successUrl,
      cancel_url: params.cancelUrl,
      metadata: { booking_order_id: params.bookingOrderId },
    },
    { idempotencyKey: params.idempotencyKey }
  );
}

/**
 * Charges the ACH-incentive-discounted package amount via US bank account
 * (ACH Direct Debit) only — `payment_method_types: ["us_bank_account"]`,
 * for the same isolation reason as the card session above. Tax is computed
 * by Stripe Tax on this exact (already-discounted) amount, satisfying the
 * "tax after discount, never before" rule. No `setup_future_usage` — this
 * package purchase is not authorization to save the bank account for
 * future use (see create-prepaid-package-checkout.ts). No
 * `payment_method_options.us_bank_account.verification_method` override —
 * Stripe's default (Financial Connections with microdeposit fallback)
 * applies, per current Stripe Checkout ACH documentation.
 */
export async function createPrepaidAchCheckoutSession(
  stripe: Stripe,
  params: CreatePrepaidCheckoutSessionParams
): Promise<Stripe.Checkout.Session> {
  return stripe.checkout.sessions.create(
    {
      mode: "payment",
      payment_method_types: ["us_bank_account"],
      customer: params.stripeCustomerId,
      automatic_tax: { enabled: true },
      line_items: [
        {
          price_data: {
            currency: "usd",
            unit_amount: toStripeCents(params.packageSubtotal),
            product_data: {
              name: params.productName,
              tax_code: RESIDENTIAL_CLEANING_TAX_CODE,
            },
          },
          quantity: 1,
        },
      ],
      payment_intent_data: { metadata: { booking_order_id: params.bookingOrderId } },
      success_url: params.successUrl,
      cancel_url: params.cancelUrl,
      metadata: { booking_order_id: params.bookingOrderId },
    },
    { idempotencyKey: params.idempotencyKey }
  );
}
