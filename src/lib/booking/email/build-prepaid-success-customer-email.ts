import { escapeHtml } from "@/lib/instant-quote/email/html-safety";
import { getFrequencyLabel } from "@/lib/quote/frequency";
import type { BookingEmailDetails } from "./booking-email-details";

function formatMoney(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

/** Customer confirmation for a prepaid package — fired only from verified webhook state, never a redirect/success page. */
export function buildPrepaidSuccessCustomerEmail(details: BookingEmailDetails) {
  const { bookingOrder, customerName } = details;
  const subject = "Your CleanPerfecto prepaid package purchase is confirmed";

  const total = bookingOrder.prepaidPackageTotal !== null ? formatMoney(bookingOrder.prepaidPackageTotal) : "N/A";
  const perCleaning = bookingOrder.effectivePricePerVisit !== null ? formatMoney(bookingOrder.effectivePricePerVisit) : "N/A";

  const textLines = [
    `Hi ${customerName},`,
    "",
    "Your payment has been received — thank you!",
    "",
    `Package: ${getFrequencyLabel(bookingOrder.frequency)} — 6 cleanings`,
    `Total paid: ${total}`,
    `Effective price per cleaning: ${perCleaning}`,
    "",
    "Your cleaning dates have not been scheduled yet — our team will follow up to arrange them.",
  ];
  const text = textLines.join("\n");

  const html = [
    `<p>Hi ${escapeHtml(customerName)},</p>`,
    "<p>Your payment has been received — thank you!</p>",
    "<ul>",
    `<li><strong>Package:</strong> ${escapeHtml(getFrequencyLabel(bookingOrder.frequency))} — 6 cleanings</li>`,
    `<li><strong>Total paid:</strong> ${total}</li>`,
    `<li><strong>Effective price per cleaning:</strong> ${perCleaning}</li>`,
    "</ul>",
    "<p>Your cleaning dates have not been scheduled yet — our team will follow up to arrange them.</p>",
  ].join("");

  return { subject, text, html };
}
