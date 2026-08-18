import { SITE_CONTACT } from "@/lib/site-contact";
import { getInstantQuoteCleaningTypeLabel, getInstantQuoteFrequencyLabel, getInstantQuotePropertyTypeLabel } from "./labels";
import { escapeHtml } from "./html-safety";
import type { InstantQuoteEmailDetails } from "./build-email-details";

function firstName(name: string): string {
  const trimmed = name.trim();
  const first = trimmed.split(/\s+/)[0];
  return first && first.length > 0 ? first : trimmed;
}

function formatMoney(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

function buildServiceSummaryLines(details: InstantQuoteEmailDetails): string[] {
  const roomDetails = [`${details.rooms.bedrooms} bedroom${details.rooms.bedrooms === 1 ? "" : "s"}`];
  roomDetails.push(`${details.rooms.fullBathrooms} full bathroom${details.rooms.fullBathrooms === 1 ? "" : "s"}`);
  if (details.rooms.halfBathrooms > 0) {
    roomDetails.push(`${details.rooms.halfBathrooms} half bathroom${details.rooms.halfBathrooms === 1 ? "" : "s"}`);
  }
  if (details.squareFeet !== null) {
    roomDetails.push(`approx. ${details.squareFeet} sq. ft.`);
  }

  const lines = [
    `Property: ${getInstantQuotePropertyTypeLabel(details.propertyType)}`,
    `Cleaning: ${getInstantQuoteCleaningTypeLabel(details.cleaningType)}`,
    `Home details: ${roomDetails.join(", ")}`,
    `Frequency: ${getInstantQuoteFrequencyLabel(details.frequency)}`,
  ];
  if (details.preferredDate) {
    lines.push(`Preferred date: ${details.preferredDate}`);
  }
  return lines;
}

const FIRST_CLEANING_OFFER_LINE = "Your eligible first-cleaning special has been included in this estimate.";
const STARTING_AT_LINE =
  "This is a starting-at estimate. Final pricing may be confirmed if the condition or selected starting-at services require additional review.";
const NO_PAYMENT_YET_LINE = "Our team will follow up to confirm final details before any payment is collected.";

function buildManualReviewEmail(details: InstantQuoteEmailDetails) {
  const subject = "We Received Your CleanPerfecto Quote Request";
  const name = firstName(details.name);
  const summaryLines = [
    `Property: ${getInstantQuotePropertyTypeLabel(details.propertyType)}`,
    `Cleaning: ${getInstantQuoteCleaningTypeLabel(details.cleaningType)}`,
    `Service address: ${[details.serviceAddress.line1, details.serviceAddress.city, details.serviceAddress.state, details.serviceAddress.zip].filter(Boolean).join(", ")}`,
    ...(details.preferredDate ? [`Preferred date: ${details.preferredDate}`] : []),
  ];

  const text = [
    `Hi ${name},`,
    "",
    "Thank you for contacting CleanPerfecto.",
    "",
    "We received your cleaning request.",
    "",
    "Your service requires a quick review so we can confirm the right scope and pricing.",
    "",
    "Our team will contact you using the information provided.",
    "",
    ...summaryLines,
    "",
    `Request reference: ${details.quoteId}`,
    "",
    "CleanPerfecto",
    "Where Clean Meets Perfection",
    "",
    `Questions? Call or text ${SITE_CONTACT.phoneDisplay}.`,
  ].join("\n");

  const html = [
    `<p>Hi ${escapeHtml(name)},</p>`,
    "<p>Thank you for contacting CleanPerfecto.</p>",
    "<p>We received your cleaning request.</p>",
    "<p>Your service requires a quick review so we can confirm the right scope and pricing.</p>",
    "<p>Our team will contact you using the information provided.</p>",
    "<ul>",
    ...summaryLines.map((line) => `<li>${escapeHtml(line)}</li>`),
    "</ul>",
    `<p><strong>Request reference:</strong> ${escapeHtml(details.quoteId)}</p>`,
    "<p>CleanPerfecto<br/>Where Clean Meets Perfection</p>",
    `<p>Questions? Call or text ${escapeHtml(SITE_CONTACT.phoneDisplay)}.</p>`,
  ].join("");

  return { subject, text, html };
}

function buildPackageEmail(details: InstantQuoteEmailDetails) {
  const subject = "Your CleanPerfecto Cleaning Estimate";
  const name = firstName(details.name);
  const totalLabel = details.hasStartingAtPricing ? "Starting at" : "Estimated prepaid package total";
  const total = formatMoney(details.prepaidPackageTotal as number);
  const perVisit = details.effectivePricePerVisit !== null ? formatMoney(details.effectivePricePerVisit) : null;

  const textLines = [
    `Hi ${name},`,
    "",
    "Thank you for choosing CleanPerfecto.",
    "",
    `Number of visits: ${details.visitCount}`,
    `${totalLabel}: ${total}`,
    ...(perVisit ? [`Effective price per visit: ${perVisit}`] : []),
    "",
    ...buildServiceSummaryLines(details),
    "",
    ...(details.firstCleaningOfferApplied ? [FIRST_CLEANING_OFFER_LINE, ""] : []),
    ...(details.hasStartingAtPricing ? [STARTING_AT_LINE, ""] : []),
    NO_PAYMENT_YET_LINE,
    "",
    `Request reference: ${details.quoteId}`,
    "",
    "CleanPerfecto",
    "Where Clean Meets Perfection",
    "",
    `Questions? Call or text ${SITE_CONTACT.phoneDisplay}.`,
  ];

  const text = textLines.join("\n");

  const htmlLines = [
    `<p>Hi ${escapeHtml(name)},</p>`,
    "<p>Thank you for choosing CleanPerfecto.</p>",
    `<p><strong>Number of visits:</strong> ${details.visitCount}<br/>`,
    `<strong>${escapeHtml(totalLabel)}:</strong> ${total}${perVisit ? `<br/><strong>Effective price per visit:</strong> ${perVisit}` : ""}</p>`,
    "<ul>",
    ...buildServiceSummaryLines(details).map((line) => `<li>${escapeHtml(line)}</li>`),
    "</ul>",
    ...(details.firstCleaningOfferApplied ? [`<p>${escapeHtml(FIRST_CLEANING_OFFER_LINE)}</p>`] : []),
    ...(details.hasStartingAtPricing ? [`<p>${escapeHtml(STARTING_AT_LINE)}</p>`] : []),
    `<p>${escapeHtml(NO_PAYMENT_YET_LINE)}</p>`,
    `<p><strong>Request reference:</strong> ${escapeHtml(details.quoteId)}</p>`,
    "<p>CleanPerfecto<br/>Where Clean Meets Perfection</p>",
    `<p>Questions? Call or text ${escapeHtml(SITE_CONTACT.phoneDisplay)}.</p>`,
  ];
  const html = htmlLines.join("");

  return { subject, text, html };
}

function buildAutomaticEstimateEmail(details: InstantQuoteEmailDetails) {
  const subject = "Your CleanPerfecto Cleaning Estimate";
  const name = firstName(details.name);
  const range = details.range as { lower: number; upper: number };
  const priceLine = details.hasStartingAtPricing
    ? `Starting at $${range.lower} – $${range.upper}`
    : `$${range.lower} – $${range.upper}`;

  const textLines = [
    `Hi ${name},`,
    "",
    "Thank you for choosing CleanPerfecto.",
    "",
    "Your estimated cleaning price:",
    "",
    priceLine,
    "",
    ...buildServiceSummaryLines(details),
    "",
    ...(details.firstCleaningOfferApplied ? [FIRST_CLEANING_OFFER_LINE, ""] : []),
    ...(details.hasStartingAtPricing ? [STARTING_AT_LINE, ""] : []),
    NO_PAYMENT_YET_LINE,
    "",
    `Request reference: ${details.quoteId}`,
    "",
    "CleanPerfecto",
    "Where Clean Meets Perfection",
    "",
    `Questions? Call or text ${SITE_CONTACT.phoneDisplay}.`,
  ];

  const text = textLines.join("\n");

  const html = [
    `<p>Hi ${escapeHtml(name)},</p>`,
    "<p>Thank you for choosing CleanPerfecto.</p>",
    "<p>Your estimated cleaning price:</p>",
    `<p style="font-size:1.25em"><strong>${escapeHtml(priceLine)}</strong></p>`,
    "<ul>",
    ...buildServiceSummaryLines(details).map((line) => `<li>${escapeHtml(line)}</li>`),
    "</ul>",
    ...(details.firstCleaningOfferApplied ? [`<p>${escapeHtml(FIRST_CLEANING_OFFER_LINE)}</p>`] : []),
    ...(details.hasStartingAtPricing ? [`<p>${escapeHtml(STARTING_AT_LINE)}</p>`] : []),
    `<p>${escapeHtml(NO_PAYMENT_YET_LINE)}</p>`,
    `<p><strong>Request reference:</strong> ${escapeHtml(details.quoteId)}</p>`,
    "<p>CleanPerfecto<br/>Where Clean Meets Perfection</p>",
    `<p>Questions? Call or text ${escapeHtml(SITE_CONTACT.phoneDisplay)}.</p>`,
  ].join("");

  return { subject, text, html };
}

/**
 * Customer-friendly confirmation email. Built entirely from
 * InstantQuoteEmailDetails (trusted server values) — never exposes
 * multipliers, supplies/travel internals, identity matching, manual review
 * reason codes, pricing_snapshot, or any database detail. Never invents a
 * discount percentage or a guaranteed final price; a starting-at result is
 * always labeled as such, and payment is never mentioned as available yet.
 */
export function buildInstantQuoteCustomerEmail(details: InstantQuoteEmailDetails) {
  if (details.estimateType === "manual_review" || details.range === null) {
    return buildManualReviewEmail(details);
  }
  if (details.prepaidPackageTotal !== null) {
    return buildPackageEmail(details);
  }
  return buildAutomaticEstimateEmail(details);
}
