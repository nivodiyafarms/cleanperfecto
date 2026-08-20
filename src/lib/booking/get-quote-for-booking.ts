import type { BookingRepository } from "./repository";
import type { BookableQuote, NotBookableReason } from "./types";

export type GetQuoteForBookingResult = { ok: true; quote: BookableQuote } | { ok: false; reason: NotBookableReason };

/**
 * Looks up a quote by id and decides whether it can proceed to booking.
 * Three reasons block booking: the quote doesn't exist, it resolved to
 * manual review (no instant range to book from), or it has no resolved
 * customer_id (a customer-identity conflict — booking_orders.customer_id
 * is NOT NULL, so booking cannot proceed until that's resolved, which is
 * out of scope for this milestone).
 */
export async function getQuoteForBooking(quoteId: string, repo: BookingRepository): Promise<GetQuoteForBookingResult> {
  const row = await repo.findQuoteRequestById(quoteId);

  if (!row) {
    return { ok: false, reason: "not_found" };
  }
  if (row.estimateType !== "instant_range" || !row.pricingSnapshot) {
    return { ok: false, reason: "manual_review" };
  }
  if (!row.customerId) {
    return { ok: false, reason: "customer_identity_conflict" };
  }
  if (!row.cleaningType) {
    // Defensive — cleaningType is always set alongside a successful
    // instant_range calculation; this only guards against a malformed row.
    return { ok: false, reason: "manual_review" };
  }

  return {
    ok: true,
    quote: {
      quoteId: row.id,
      customerId: row.customerId,
      cleaningType: row.cleaningType,
      baseInput: row.pricingSnapshot.input,
      emailNormalized: row.emailNormalized,
      phoneNormalized: row.phoneNormalized,
      serviceAddressIdentity: row.serviceAddressIdentity,
      serviceAddressLine1: row.serviceAddressLine1,
      serviceAddressLine2: row.serviceAddressLine2,
      serviceCity: row.serviceCity,
      serviceState: row.serviceState,
    },
  };
}
