import { getAddOnLabel, getConditionLabel, getInstantQuoteCleaningTypeLabel, getInstantQuoteFrequencyLabel, getInstantQuotePropertyTypeLabel } from "./labels";
import { escapeHtml, sanitizeForEmailHeader } from "./html-safety";
import type { InstantQuoteEmailDetails } from "./build-email-details";

function formatMoney(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

function formatAddOnIds(ids: string[]): string {
  return ids.map((id) => getAddOnLabel(id as Parameters<typeof getAddOnLabel>[0])).join(", ");
}

function buildServiceAddressLines(details: InstantQuoteEmailDetails): string[] {
  const { line1, line2, city, state, zip } = details.serviceAddress;
  const lines = [line1, line2].filter((part): part is string => Boolean(part && part.trim().length > 0));
  const cityStateZip = [city, state].filter(Boolean).join(", ");
  const cityLine = [cityStateZip, zip].filter(Boolean).join(" ");
  return [...lines, cityLine].filter((line) => line.trim().length > 0);
}

function buildAddOnLines(details: InstantQuoteEmailDetails): string[] {
  if (details.isPrepaidPackage && details.visitAddOns && details.visitAddOns.length > 0) {
    return details.visitAddOns.map((idsForVisit, index) => {
      const visitNumber = index + 1;
      const labels = idsForVisit.length > 0 ? formatAddOnIds(idsForVisit) : "None";
      return `Visit ${visitNumber}: ${labels}`;
    });
  }
  if (details.addOnIds.length > 0) {
    return [formatAddOnIds(details.addOnIds)];
  }
  return ["None"];
}

export function buildInstantQuoteAdminEmail(details: InstantQuoteEmailDetails) {
  const estimateLabel = details.estimateType === "manual_review" ? "Manual Review" : "Instant Estimate";
  // Header-injection guard: details.name is customer-controlled free text
  // with no character-set restriction (only a length check), so it could
  // contain an embedded CR/LF — strip it before it becomes part of a
  // header field. Escaping (HTML markup) is a separate, unrelated concern
  // handled below wherever this subject/name is placed into the HTML body.
  const subject = `New Instant Quote — ${sanitizeForEmailHeader(details.name)} — ${estimateLabel}`;

  const addressLines = buildServiceAddressLines(details);
  const addOnLines = buildAddOnLines(details);

  const packageStatus = details.isPrepaidPackage
    ? `Prepaid package — ${details.visitCount} visits`
    : `${getInstantQuoteFrequencyLabel(details.frequency)}${details.frequency !== "one_time" ? " (not prepaid)" : ""}`;

  const textLines = [
    subject,
    "",
    `Quote ID: ${details.quoteId}`,
    "",
    "--- Customer ---",
    `Name: ${details.name}`,
    `Phone: ${details.phone ?? "Not provided"}`,
    `Email: ${details.email ?? "Not provided"}`,
    "",
    "--- Service ---",
    `Service address: ${addressLines.length > 0 ? addressLines.join(", ") : "Not provided"}`,
    `Property type: ${getInstantQuotePropertyTypeLabel(details.propertyType)}`,
    `Cleaning type: ${getInstantQuoteCleaningTypeLabel(details.cleaningType)}`,
    `Bedrooms: ${details.rooms.bedrooms}`,
    `Full bathrooms: ${details.rooms.fullBathrooms}`,
    `Half bathrooms: ${details.rooms.halfBathrooms}`,
    `Square footage: ${details.squareFeet ?? "Not provided"}`,
    `Condition: ${getConditionLabel(details.condition)}`,
    `Frequency: ${getInstantQuoteFrequencyLabel(details.frequency)}`,
    `Package status: ${packageStatus}`,
    `Preferred date: ${details.preferredDate ?? "Not provided"}`,
    `Lead source: ${details.leadSource ?? "Not provided"}${details.leadSourceDetail ? ` (${details.leadSourceDetail})` : ""}`,
    `Message: ${details.message ?? "Not provided"}`,
    "",
    "--- Pricing (internal) ---",
    `Estimate type: ${details.estimateType}`,
    `Customer-facing range: ${details.range ? `$${details.range.lower} - $${details.range.upper}` : "N/A (manual review)"}`,
    `Authoritative calculated total: ${formatMoney(details.calculatedTotal)}`,
    `First-cleaning offer applied: ${details.firstCleaningOfferApplied ? "Yes" : "No"}`,
    `Starting-at pricing: ${details.hasStartingAtPricing ? "Yes" : "No"}`,
    ...(details.prepaidPackageTotal !== null
      ? [`Prepaid package total: ${formatMoney(details.prepaidPackageTotal)}`]
      : []),
    ...(details.effectivePricePerVisit !== null
      ? [`Effective price/visit: ${formatMoney(details.effectivePricePerVisit)}`]
      : []),
    "",
    "--- Add-ons ---",
    ...addOnLines,
    "",
    "--- Manual review ---",
    details.manualReviewRequired
      ? `Manual review required. Reasons: ${details.manualReviewReasons.join(", ") || "(none listed)"}`
      : "Not required.",
    ...(details.identityConflict
      ? ["Identity conflict detected — customer association requires admin review."]
      : []),
  ];

  const text = textLines.join("\n");

  const htmlAddOnLines = addOnLines.map((line) => `<li>${escapeHtml(line)}</li>`).join("");
  const html = [
    `<h2>${escapeHtml(subject)}</h2>`,
    `<p><strong>Quote ID:</strong> ${escapeHtml(details.quoteId)}</p>`,
    "<h3>Customer</h3>",
    "<ul>",
    `<li><strong>Name:</strong> ${escapeHtml(details.name)}</li>`,
    `<li><strong>Phone:</strong> ${escapeHtml(details.phone ?? "Not provided")}</li>`,
    `<li><strong>Email:</strong> ${escapeHtml(details.email ?? "Not provided")}</li>`,
    "</ul>",
    "<h3>Service</h3>",
    "<ul>",
    `<li><strong>Service address:</strong> ${escapeHtml(addressLines.length > 0 ? addressLines.join(", ") : "Not provided")}</li>`,
    `<li><strong>Property type:</strong> ${escapeHtml(getInstantQuotePropertyTypeLabel(details.propertyType))}</li>`,
    `<li><strong>Cleaning type:</strong> ${escapeHtml(getInstantQuoteCleaningTypeLabel(details.cleaningType))}</li>`,
    `<li><strong>Bedrooms:</strong> ${details.rooms.bedrooms}</li>`,
    `<li><strong>Full bathrooms:</strong> ${details.rooms.fullBathrooms}</li>`,
    `<li><strong>Half bathrooms:</strong> ${details.rooms.halfBathrooms}</li>`,
    `<li><strong>Square footage:</strong> ${details.squareFeet ?? "Not provided"}</li>`,
    `<li><strong>Condition:</strong> ${escapeHtml(getConditionLabel(details.condition))}</li>`,
    `<li><strong>Frequency:</strong> ${escapeHtml(getInstantQuoteFrequencyLabel(details.frequency))}</li>`,
    `<li><strong>Package status:</strong> ${escapeHtml(packageStatus)}</li>`,
    `<li><strong>Preferred date:</strong> ${escapeHtml(details.preferredDate ?? "Not provided")}</li>`,
    `<li><strong>Lead source:</strong> ${escapeHtml(details.leadSource ?? "Not provided")}${details.leadSourceDetail ? ` (${escapeHtml(details.leadSourceDetail)})` : ""}</li>`,
    `<li><strong>Message:</strong> ${escapeHtml(details.message ?? "Not provided")}</li>`,
    "</ul>",
    "<h3>Pricing (internal)</h3>",
    "<ul>",
    `<li><strong>Estimate type:</strong> ${escapeHtml(details.estimateType)}</li>`,
    `<li><strong>Customer-facing range:</strong> ${details.range ? `$${details.range.lower} - $${details.range.upper}` : "N/A (manual review)"}</li>`,
    `<li><strong>Authoritative calculated total:</strong> ${formatMoney(details.calculatedTotal)}</li>`,
    `<li><strong>First-cleaning offer applied:</strong> ${details.firstCleaningOfferApplied ? "Yes" : "No"}</li>`,
    `<li><strong>Starting-at pricing:</strong> ${details.hasStartingAtPricing ? "Yes" : "No"}</li>`,
    ...(details.prepaidPackageTotal !== null
      ? [`<li><strong>Prepaid package total:</strong> ${formatMoney(details.prepaidPackageTotal)}</li>`]
      : []),
    ...(details.effectivePricePerVisit !== null
      ? [`<li><strong>Effective price/visit:</strong> ${formatMoney(details.effectivePricePerVisit)}</li>`]
      : []),
    "</ul>",
    "<h3>Add-ons</h3>",
    `<ul>${htmlAddOnLines}</ul>`,
    "<h3>Manual review</h3>",
    `<p>${
      details.manualReviewRequired
        ? `Manual review required. Reasons: ${escapeHtml(details.manualReviewReasons.join(", ") || "(none listed)")}`
        : "Not required."
    }</p>`,
    ...(details.identityConflict
      ? ["<p><strong>Identity conflict detected — customer association requires admin review.</strong></p>"]
      : []),
  ].join("");

  return { subject, text, html };
}
