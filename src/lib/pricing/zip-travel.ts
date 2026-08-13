export interface ZipTravelRule {
  zip: string;
  percentage: number;
  band: string;
}

export type ZipTravelLookupResult =
  | { configured: true; percentage: number; band: string }
  | { configured: false; reason: "ZIP_TRAVEL_NOT_CONFIGURED" };

/**
 * Production ZIP travel table — intentionally empty. Lewisville, TX is the
 * operational reference point; the owner will supply the full DFW ZIP table
 * separately (owner message 2026-08-12, item 2 / CLAUDE.md "Service Area").
 * Do not add entries here without explicit approval — tests must use their
 * own isolated fixtures via the `config` parameter below, never this array.
 */
export const ZIP_TRAVEL_CONFIG: ZipTravelRule[] = [];

/**
 * Deterministic: the same ZIP always resolves to the same percentage for a
 * given config — never a per-customer or per-call variation. An unconfigured
 * ZIP returns a typed manual-review reason rather than a guessed percentage.
 */
export function getZipTravelRule(
  zip: string,
  config: ZipTravelRule[] = ZIP_TRAVEL_CONFIG
): ZipTravelLookupResult {
  const match = config.find((rule) => rule.zip === zip);
  if (!match) {
    return { configured: false, reason: "ZIP_TRAVEL_NOT_CONFIGURED" };
  }
  return { configured: true, percentage: match.percentage, band: match.band };
}
