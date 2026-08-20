import { escapeHtml, sanitizeForEmailHeader } from "@/lib/instant-quote/email/html-safety";
import { getFrequencyLabel } from "@/lib/quote/frequency";
import type { BookingEmailDetails } from "./booking-email-details";

function formatMoney(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

/**
 * Admin notification for a prepaid package — fired only after a verified
 * Stripe payment event activates the package (see
 * webhook/process-stripe-webhook-event.ts). Never fired from a redirect/
 * success page.
 */
export function buildPrepaidSuccessAdminEmail(details: BookingEmailDetails) {
  const { bookingOrder, customerName, customerEmail, customerPhone } = details;
  const subject = `Prepaid package purchased — ${sanitizeForEmailHeader(customerName)}`;

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
    "--- Package ---",
    `Cleaning type: ${bookingOrder.cleaningType}`,
    `Frequency: ${getFrequencyLabel(bookingOrder.frequency)}`,
    `Package total (paid): ${bookingOrder.prepaidPackageTotal !== null ? formatMoney(bookingOrder.prepaidPackageTotal) : "N/A"}`,
    `Effective price/cleaning: ${bookingOrder.effectivePricePerVisit !== null ? formatMoney(bookingOrder.effectivePricePerVisit) : "N/A"}`,
    "Payment status: verified paid (Stripe webhook).",
    "Cleaning dates: not yet scheduled.",
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
    "<h3>Package</h3>",
    "<ul>",
    `<li><strong>Cleaning type:</strong> ${escapeHtml(bookingOrder.cleaningType)}</li>`,
    `<li><strong>Frequency:</strong> ${escapeHtml(getFrequencyLabel(bookingOrder.frequency))}</li>`,
    `<li><strong>Package total (paid):</strong> ${bookingOrder.prepaidPackageTotal !== null ? formatMoney(bookingOrder.prepaidPackageTotal) : "N/A"}</li>`,
    `<li><strong>Effective price/cleaning:</strong> ${bookingOrder.effectivePricePerVisit !== null ? formatMoney(bookingOrder.effectivePricePerVisit) : "N/A"}</li>`,
    "<li><strong>Payment status:</strong> verified paid (Stripe webhook).</li>",
    "<li><strong>Cleaning dates:</strong> not yet scheduled.</li>",
    "</ul>",
  ].join("");

  return { subject, text, html };
}
