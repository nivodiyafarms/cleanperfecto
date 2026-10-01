import type { BookingOrderRow } from "@/lib/booking/types";

export interface BookingAuthorizationEvidence {
  hasEvidence: boolean;
  consentVersionId: string | null;
  cancellationPolicyVersion: string | null;
  cancellationPolicyTextSnapshot: string | null;
  paymentAuthorizationTextSnapshot: string | null;
  paymentAuthorizationAcceptedAt: string | null;
}

/**
 * Shapes booking_orders' immutable, booking-level evidence columns for
 * admin display — deliberately reads ONLY the persisted snapshot columns
 * on the row (never CANCELLATION_POLICY_TIERS, SAVED_PAYMENT_AUTHORIZATION_COPY,
 * or any other live constant), so a historical booking always shows exactly
 * what it actually captured at booking time, even after those constants
 * are later revised. See protect_booking_order_consent_evidence (DB trigger)
 * for the write-side guarantee this display-side function relies on.
 */
export function buildBookingAuthorizationEvidence(bookingOrder: BookingOrderRow | null): BookingAuthorizationEvidence {
  if (!bookingOrder) {
    return {
      hasEvidence: false,
      consentVersionId: null,
      cancellationPolicyVersion: null,
      cancellationPolicyTextSnapshot: null,
      paymentAuthorizationTextSnapshot: null,
      paymentAuthorizationAcceptedAt: null,
    };
  }

  return {
    hasEvidence: true,
    consentVersionId: bookingOrder.consentVersionId,
    cancellationPolicyVersion: bookingOrder.cancellationPolicyVersion,
    cancellationPolicyTextSnapshot: bookingOrder.cancellationPolicyTextSnapshot,
    paymentAuthorizationTextSnapshot: bookingOrder.paymentAuthorizationTextSnapshot,
    paymentAuthorizationAcceptedAt: bookingOrder.paymentAuthorizationAcceptedAt,
  };
}
