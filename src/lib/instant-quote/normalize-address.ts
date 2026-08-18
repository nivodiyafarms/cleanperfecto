/**
 * Pure server-side helper for `service_address_identity`, shared by both
 * quote_requests and (future) service_visits — see the column comments on
 * both tables in the approved migrations. Never trust a client-generated
 * identity string; only this function may produce one.
 *
 * Concept: `ZIP5 | normalized street | normalized unit`. The unit always
 * participates (defaulting to an empty segment when absent) so two
 * addresses at the same street with different units never collide, and a
 * bare ZIP is never used as a stand-in for the whole identity.
 *
 * Deliberately conservative: uppercase, trim, collapse whitespace, and
 * strip a small set of harmless punctuation (periods, commas). No address
 * standardization ("St" vs "Street"), no geocoding, no external API.
 */

const HARMLESS_PUNCTUATION_PATTERN = /[.,]/g;
const WHITESPACE_PATTERN = /\s+/g;

function normalizeAddressPart(rawPart: string): string {
  return rawPart
    .replace(HARMLESS_PUNCTUATION_PATTERN, "")
    .trim()
    .replace(WHITESPACE_PATTERN, " ")
    .toUpperCase();
}

function extractZip5(rawZip: string): string | null {
  const digits = rawZip.replace(/\D/g, "");
  if (digits.length < 5) {
    return null;
  }
  return digits.slice(0, 5);
}

export interface ServiceAddressIdentityInput {
  zip: string;
  /** Street line — required to build a meaningful identity; see below. */
  line1: string;
  /** Apartment/unit, if any. */
  line2?: string | null;
}

/**
 * Returns null when a meaningful identity can't be built — either the ZIP
 * doesn't resolve to 5 digits, or the street line is blank. A degenerate
 * "ZIP-only" identity is never returned, per the approved requirement that
 * ZIP alone must never stand in for the full address identity.
 */
export function buildServiceAddressIdentity(input: ServiceAddressIdentityInput): string | null {
  const zip5 = extractZip5(input.zip);
  const normalizedStreet = normalizeAddressPart(input.line1 ?? "");
  const normalizedUnit = normalizeAddressPart(input.line2 ?? "");

  if (zip5 === null || normalizedStreet.length === 0) {
    return null;
  }

  return `${zip5}|${normalizedStreet}|${normalizedUnit}`;
}
