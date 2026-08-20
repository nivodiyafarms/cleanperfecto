import "server-only";

import type Stripe from "stripe";
import type { BookingRepository } from "../repository";

export interface ServiceAddressForTax {
  line1: string | null;
  line2: string | null;
  city: string | null;
  state: string | null;
  zip: string;
}

/**
 * Reuses the customer's existing Stripe Customer id if one is already
 * stored (customers.stripe_customer_id), else creates one and persists it
 * back — so the same real-world customer maps to the same Stripe Customer
 * across bookings. Also syncs the (already known, server-snapshotted)
 * service address onto the Stripe Customer: per Stripe Tax guidance, when
 * an existing `customer` id is passed to a Checkout Session, Checkout uses
 * that customer's saved address for tax by default, so this avoids
 * re-prompting the customer for an address Checkout already has.
 */
export async function resolveStripeCustomerId(
  stripe: Stripe,
  customerId: string,
  serviceAddress: ServiceAddressForTax,
  repo: BookingRepository
): Promise<string> {
  const customer = await repo.getCustomerForStripe(customerId);
  if (!customer) {
    throw new Error(`[booking] customer ${customerId} not found while resolving Stripe customer`);
  }

  const address: Stripe.AddressParam = {
    line1: serviceAddress.line1 ?? undefined,
    line2: serviceAddress.line2 ?? undefined,
    city: serviceAddress.city ?? undefined,
    state: serviceAddress.state ?? undefined,
    postal_code: serviceAddress.zip,
    country: "US",
  };

  if (customer.stripeCustomerId) {
    await stripe.customers.update(customer.stripeCustomerId, { address });
    return customer.stripeCustomerId;
  }

  const created = await stripe.customers.create({
    name: customer.name,
    email: customer.email ?? undefined,
    phone: customer.phone ?? undefined,
    address,
  });

  await repo.setCustomerStripeId(customerId, created.id);
  return created.id;
}
