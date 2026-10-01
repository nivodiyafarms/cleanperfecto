import "server-only";

import type Stripe from "stripe";
import type { BookingRepository } from "@/lib/booking/repository";
import { getSiteUrl } from "@/lib/booking/site-url";
import { resolveStripeCustomerId } from "@/lib/booking/stripe/customers";
import { assertCanCreateStripeSetup } from "@/lib/config/payment-capabilities";
import type { ServiceVisitRow } from "@/lib/scheduling/domain-types";

/**
 * Creates a setup-mode Stripe Checkout Session for the customer-portal
 * "Add / Update Payment Method" flow — reuses the exact same Stripe-hosted
 * setup-mode mechanism already proven for initial booking setup (no raw
 * card data ever reaches CleanPerfecto), tagged with
 * `metadata.purpose = 'update_payment_method'` so the webhook
 * (handlePaymentMethodUpdateSetupCompleted) recognizes it as distinct from
 * the original booking-setup flow and never looks for a booking_order_id.
 *
 * Deliberately does NOT go through payment_attempts/getOrCreateCheckoutSessionUrl
 * — that table's booking_order_id is NOT NULL and this flow has no booking
 * order at all; the webhook's own effect (overwriting
 * customers.stripe_default_payment_method_id) is itself idempotent, so no
 * additional Checkout-Session-level dedup is needed here.
 */
export async function createPaymentMethodSetupCheckoutSession(
  stripe: Stripe,
  bookingRepo: BookingRepository,
  customerId: string,
  visit: Pick<ServiceVisitRow, "serviceAddressLine1" | "serviceAddressLine2" | "serviceCity" | "serviceState">,
  zip: string
): Promise<string> {
  assertCanCreateStripeSetup();

  const stripeCustomerId = await resolveStripeCustomerId(
    stripe,
    customerId,
    { line1: visit.serviceAddressLine1, line2: visit.serviceAddressLine2, city: visit.serviceCity, state: visit.serviceState, zip },
    bookingRepo
  );

  const siteUrl = getSiteUrl();
  // payment_method_types: ["card"] — same requirement as the original
  // booking setup session (createSetupCheckoutSession): Pay Per Cleaning's
  // post-cleaning PaymentIntent is card-only, so a customer updating their
  // saved payment method here must not be able to save a non-card
  // PaymentMethod (e.g. Link) as their new default.
  const session = await stripe.checkout.sessions.create({
    mode: "setup",
    currency: "usd",
    payment_method_types: ["card"],
    customer: stripeCustomerId,
    success_url: `${siteUrl}/my/payments`,
    cancel_url: `${siteUrl}/my/payments`,
    metadata: { purpose: "update_payment_method", customer_id: customerId },
  });

  if (!session.url) {
    throw new Error("[payments] Stripe setup-mode Checkout Session created with no url");
  }
  return session.url;
}
