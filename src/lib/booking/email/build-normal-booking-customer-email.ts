import { escapeHtml } from "@/lib/instant-quote/email/html-safety";
import { formatRequestedStartTime } from "../format-start-time";
import { getFrequencyLabel } from "@/lib/quote/frequency";
import type { BookingEmailDetails } from "./booking-email-details";

/** Legacy fallback for booking_orders rows created before the specific start-time picker (requestedTimeWindow) — see format-start-time.ts. */
const TIME_WINDOW_LABELS: Record<string, string> = { morning: "Morning", afternoon: "Afternoon", evening: "Evening" };

/**
 * Customer confirmation for a normal booking. Must never say "paid" —
 * only a payment method was securely saved; no charge has been collected,
 * and the booking is pending CleanPerfecto's confirmation, not a
 * guaranteed appointment.
 */
export function buildNormalBookingCustomerEmail(details: BookingEmailDetails) {
  const { bookingOrder, customerName } = details;
  const subject = "Your CleanPerfecto booking request has been received";
  const timeWindowLabel =
    formatRequestedStartTime(bookingOrder.requestedStartTime) ??
    (bookingOrder.requestedTimeWindow ? TIME_WINDOW_LABELS[bookingOrder.requestedTimeWindow] : "your preferred time");

  const textLines = [
    `Hi ${customerName},`,
    "",
    "Thanks for booking with CleanPerfecto! Here's what we have on file:",
    "",
    `Cleaning: ${getFrequencyLabel(bookingOrder.frequency)} ${bookingOrder.cleaningType} cleaning`,
    `Requested date: ${bookingOrder.requestedDate ?? "Not provided"}`,
    `Requested time: ${timeWindowLabel}`,
    "",
    "Your payment method has been securely saved with Stripe. Your card has NOT been charged today.",
    "",
    "Our team will follow up to confirm availability for your requested date and time.",
  ];
  const text = textLines.join("\n");

  const html = [
    `<p>Hi ${escapeHtml(customerName)},</p>`,
    "<p>Thanks for booking with CleanPerfecto! Here's what we have on file:</p>",
    "<ul>",
    `<li><strong>Cleaning:</strong> ${escapeHtml(getFrequencyLabel(bookingOrder.frequency))} ${escapeHtml(bookingOrder.cleaningType)} cleaning</li>`,
    `<li><strong>Requested date:</strong> ${escapeHtml(bookingOrder.requestedDate ?? "Not provided")}</li>`,
    `<li><strong>Requested time:</strong> ${escapeHtml(timeWindowLabel)}</li>`,
    "</ul>",
    "<p>Your payment method has been securely saved with Stripe. <strong>Your card has NOT been charged today.</strong></p>",
    "<p>Our team will follow up to confirm availability for your requested date and time.</p>",
  ].join("");

  return { subject, text, html };
}
