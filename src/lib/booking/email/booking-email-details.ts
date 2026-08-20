import type { BookingRepository } from "../repository";
import type { BookingOrderRow } from "../types";

export interface BookingEmailDetails {
  bookingOrder: BookingOrderRow;
  customerName: string;
  customerEmail: string | null;
  customerPhone: string | null;
}

/**
 * Fetches exactly what a booking confirmation email needs — the booking
 * order plus the customer's contact info. Reuses
 * BookingRepository.getCustomerForStripe (it already returns
 * id/name/email/phone) rather than adding a near-duplicate repository
 * method just for a different caller.
 */
export async function loadBookingEmailDetails(
  repo: BookingRepository,
  bookingOrderId: string
): Promise<BookingEmailDetails | null> {
  const bookingOrder = await repo.findBookingOrderById(bookingOrderId);
  if (!bookingOrder) return null;

  const customer = await repo.getCustomerForStripe(bookingOrder.customerId);
  if (!customer) return null;

  return {
    bookingOrder,
    customerName: customer.name,
    customerEmail: customer.email,
    customerPhone: customer.phone,
  };
}
