import { escapeHtml, sanitizeForEmailHeader } from "@/lib/instant-quote/email/html-safety";
import { formatRequestedStartTime } from "../format-start-time";
import { getFrequencyLabel } from "@/lib/quote/frequency";
import type { BookingEmailDetails } from "./booking-email-details";

/** Legacy fallback for booking_orders rows created before the specific start-time picker (requestedTimeWindow) — see format-start-time.ts. */
const TIME_WINDOW_LABELS: Record<string, string> = { morning: "Morning", afternoon: "Afternoon", evening: "Evening" };

/**
 * Admin notification for a normal booking whose payment method has been
 * verified as secured (never fired on bare checkout.session.completed —
 * see webhook/process-stripe-webhook-event.ts). Explicitly never says
 * "paid" — a normal booking is not charged in this milestone.
 */
export function buildNormalBookingAdminEmail(details: BookingEmailDetails) {
  const { bookingOrder, customerName, customerEmail, customerPhone } = details;
  const subject = `Booking request received — ${sanitizeForEmailHeader(customerName)} — pending confirmation`;

  const addressLine =
    [bookingOrder.serviceAddressLine1, bookingOrder.serviceAddressLine2].filter(Boolean).join(" ") ||
    "Not provided";
  const timeWindowLabel =
    formatRequestedStartTime(bookingOrder.requestedStartTime) ??
    (bookingOrder.requestedTimeWindow ? TIME_WINDOW_LABELS[bookingOrder.requestedTimeWindow] : "Not provided");

  const textLines = [
    subject,
    "",
    `Booking order ID: ${bookingOrder.id}`,
    `Quote ID: ${bookingOrder.quoteRequestId}`,
    "",
    "--- Customer ---",
    `Name: ${customerName}`,
    `Phone: ${customerPhone ?? "Not provided"}`,
    `Email: ${customerEmail ?? "Not provided"}`,
    "",
    "--- Booking ---",
    `Cleaning type: ${bookingOrder.cleaningType}`,
    `Frequency: ${getFrequencyLabel(bookingOrder.frequency)}`,
    `Service address: ${addressLine}`,
    `Requested date: ${bookingOrder.requestedDate ?? "Not provided"}`,
    `Requested time: ${timeWindowLabel}`,
    "",
    "--- Payment ---",
    "Payment method securely saved via Stripe. No charge has been collected.",
    "Status: pending confirmation — CleanPerfecto must confirm availability.",
  ];
  const text = textLines.join("\n");

  const html = [
    `<h2>${escapeHtml(subject)}</h2>`,
    `<p><strong>Booking order ID:</strong> ${escapeHtml(bookingOrder.id)}</p>`,
    `<p><strong>Quote ID:</strong> ${escapeHtml(bookingOrder.quoteRequestId)}</p>`,
    "<h3>Customer</h3>",
    "<ul>",
    `<li><strong>Name:</strong> ${escapeHtml(customerName)}</li>`,
    `<li><strong>Phone:</strong> ${escapeHtml(customerPhone ?? "Not provided")}</li>`,
    `<li><strong>Email:</strong> ${escapeHtml(customerEmail ?? "Not provided")}</li>`,
    "</ul>",
    "<h3>Booking</h3>",
    "<ul>",
    `<li><strong>Cleaning type:</strong> ${escapeHtml(bookingOrder.cleaningType)}</li>`,
    `<li><strong>Frequency:</strong> ${escapeHtml(getFrequencyLabel(bookingOrder.frequency))}</li>`,
    `<li><strong>Service address:</strong> ${escapeHtml(addressLine)}</li>`,
    `<li><strong>Requested date:</strong> ${escapeHtml(bookingOrder.requestedDate ?? "Not provided")}</li>`,
    `<li><strong>Requested time:</strong> ${escapeHtml(timeWindowLabel)}</li>`,
    "</ul>",
    "<h3>Payment</h3>",
    "<p>Payment method securely saved via Stripe. No charge has been collected.</p>",
    "<p><strong>Status:</strong> pending confirmation — CleanPerfecto must confirm availability.</p>",
  ].join("");

  return { subject, text, html };
}
