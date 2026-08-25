import type { ServiceVisitRow } from "@/lib/scheduling/domain-types";
import { InvalidVisitStateError } from "@/lib/scheduling/errors";
import type { TaxLocationAddress } from "./visit-payment-gateway";

/**
 * Resolves the frozen, server-authoritative service-location address used
 * for the Stripe Tax Calculation — never the customer's current profile/
 * billing/Stripe Customer address (see the approved architecture's tax-
 * location invariant).
 *
 * NOTE on service_visits.service_zip: that column exists in the schema but
 * is never populated by any current code path (booking_orders itself has
 * no standalone zip column to source it from — only the combined
 * service_address_identity string). Rather than widen booking_orders'
 * data model (out of scope for this milestone, and risking the "preserve
 * previously validated behavior" constraint), the ZIP is derived from the
 * leading segment of service_address_identity, which IS reliably populated
 * — see buildServiceAddressIdentity (src/lib/instant-quote/normalize-address.ts),
 * whose only output format is `${zip5}|${normalizedStreet}|${normalizedUnit}`.
 * This is the same ZIP value service_zip would have held; it is sourced
 * from the one place it's actually guaranteed to be correct today.
 */
export function resolveTaxLocationAddress(visit: ServiceVisitRow): TaxLocationAddress {
  const zip = extractZip5FromServiceAddressIdentity(visit.serviceAddressIdentity);
  if (!zip) {
    throw new InvalidVisitStateError(`service_visit ${visit.id} has no resolvable service ZIP code — cannot calculate Stripe Tax without a known service location.`);
  }
  return {
    line1: visit.serviceAddressLine1,
    line2: visit.serviceAddressLine2,
    city: visit.serviceCity,
    state: visit.serviceState,
    zip,
  };
}

function extractZip5FromServiceAddressIdentity(serviceAddressIdentity: string | null): string | null {
  if (!serviceAddressIdentity) return null;
  const [zip5] = serviceAddressIdentity.split("|");
  if (!zip5 || !/^\d{5}$/.test(zip5)) return null;
  return zip5;
}
