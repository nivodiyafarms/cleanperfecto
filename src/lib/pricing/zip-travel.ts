export type TravelBand = "core" | "nearby" | "extended" | "outer" | "manual_review";

/** Bands that resolve to an automatic travel percentage — everything except "manual_review". */
export type AutomaticTravelBand = Exclude<TravelBand, "manual_review">;

/**
 * Approved travel percentage per automatic band, owner-approved 2026-08-13.
 * Core: 0-10 mi, Nearby: 11-20 mi, Extended: 21-30 mi, Outer: 31-40 mi.
 * "manual_review" (over 40 mi) deliberately has no entry here — see
 * ZIP_TRAVEL_CONFIG and getZipTravelRule below for how those ZIPs resolve.
 */
export const TRAVEL_BAND_PERCENTAGES: Record<AutomaticTravelBand, number> = {
  core: 0,
  nearby: 0.03,
  extended: 0.06,
  outer: 0.1,
};

/** CleanPerfecto's travel/home-base ZIP — must always resolve to Core / 0%. */
export const BASE_ZIP = "75056";

export interface ZipTravelRule {
  zip: string;
  /** Null only for "manual_review" entries — never a guessed percentage. */
  percentage: number | null;
  band: TravelBand;
}

export type ZipTravelLookupResult =
  | { configured: true; percentage: number; band: AutomaticTravelBand }
  | { configured: false; reason: "ZIP_MANUAL_REVIEW_REQUIRED"; band: "manual_review" }
  | { configured: false; reason: "ZIP_TRAVEL_NOT_CONFIGURED" };

/**
 * Production ZIP travel table, owner-approved 2026-08-13. Converted
 * (offline, at authoring time) from the approved source file
 * `CleanPerfecto_DFW_ZIP_Travel_Bands_Simple.csv` — the `band` column is
 * the production assignment; `estimated_miles` does not participate in
 * runtime calculation.
 *
 * All 273 approved ZIPs are represented explicitly, including the 88 whose
 * CSV band was "Manual review" (over 40 miles) — those entries carry
 * `band: "manual_review"` and `percentage: null` rather than being omitted,
 * so a known-but-out-of-automatic-range DFW ZIP stays distinguishable from a
 * ZIP that was never in the approved table at all (see getZipTravelRule).
 * No runtime CSV parsing or filesystem access — this array is the deployed
 * configuration. Do not add or edit entries here without a new approved
 * CSV; do not duplicate a ZIP. Tests must use their own isolated fixtures
 * via the `config` parameter, never this array.
 */
export const ZIP_TRAVEL_CONFIG: ZipTravelRule[] = [
  { zip: "75001", percentage: 0.03, band: "nearby" },
  { zip: "75002", percentage: 0.06, band: "extended" },
  { zip: "75006", percentage: 0, band: "core" },
  { zip: "75007", percentage: 0, band: "core" },
  { zip: "75009", percentage: 0.06, band: "extended" },
  { zip: "75010", percentage: 0, band: "core" },
  { zip: "75013", percentage: 0.03, band: "nearby" },
  { zip: "75019", percentage: 0.03, band: "nearby" },
  { zip: "75022", percentage: 0.03, band: "nearby" },
  { zip: "75023", percentage: 0.03, band: "nearby" },
  { zip: "75024", percentage: 0, band: "core" },
  { zip: "75025", percentage: 0.03, band: "nearby" },
  { zip: "75028", percentage: 0.03, band: "nearby" },
  { zip: "75032", percentage: 0.1, band: "outer" },
  { zip: "75033", percentage: 0.03, band: "nearby" },
  { zip: "75034", percentage: 0, band: "core" },
  { zip: "75035", percentage: 0.03, band: "nearby" },
  { zip: "75036", percentage: 0, band: "core" },
  { zip: "75038", percentage: 0.03, band: "nearby" },
  { zip: "75039", percentage: 0.03, band: "nearby" },
  { zip: "75040", percentage: 0.06, band: "extended" },
  { zip: "75041", percentage: 0.06, band: "extended" },
  { zip: "75042", percentage: 0.06, band: "extended" },
  { zip: "75043", percentage: 0.06, band: "extended" },
  { zip: "75044", percentage: 0.06, band: "extended" },
  { zip: "75048", percentage: 0.06, band: "extended" },
  { zip: "75050", percentage: 0.06, band: "extended" },
  { zip: "75051", percentage: 0.06, band: "extended" },
  { zip: "75052", percentage: 0.1, band: "outer" },
  { zip: "75054", percentage: null, band: "manual_review" },
  { zip: "75056", percentage: 0, band: "core" },
  { zip: "75057", percentage: 0, band: "core" },
  { zip: "75060", percentage: 0.06, band: "extended" },
  { zip: "75061", percentage: 0.06, band: "extended" },
  { zip: "75062", percentage: 0.03, band: "nearby" },
  { zip: "75063", percentage: 0.03, band: "nearby" },
  { zip: "75065", percentage: 0, band: "core" },
  { zip: "75067", percentage: 0, band: "core" },
  { zip: "75068", percentage: 0, band: "core" },
  { zip: "75069", percentage: 0.06, band: "extended" },
  { zip: "75070", percentage: 0.03, band: "nearby" },
  { zip: "75071", percentage: 0.06, band: "extended" },
  { zip: "75072", percentage: 0.03, band: "nearby" },
  { zip: "75074", percentage: 0.03, band: "nearby" },
  { zip: "75075", percentage: 0.03, band: "nearby" },
  { zip: "75077", percentage: 0.03, band: "nearby" },
  { zip: "75078", percentage: 0.03, band: "nearby" },
  { zip: "75080", percentage: 0.03, band: "nearby" },
  { zip: "75081", percentage: 0.03, band: "nearby" },
  { zip: "75082", percentage: 0.03, band: "nearby" },
  { zip: "75087", percentage: 0.1, band: "outer" },
  { zip: "75088", percentage: 0.06, band: "extended" },
  { zip: "75089", percentage: 0.06, band: "extended" },
  { zip: "75093", percentage: 0, band: "core" },
  { zip: "75094", percentage: 0.06, band: "extended" },
  { zip: "75098", percentage: 0.06, band: "extended" },
  { zip: "75101", percentage: null, band: "manual_review" },
  { zip: "75104", percentage: null, band: "manual_review" },
  { zip: "75114", percentage: null, band: "manual_review" },
  { zip: "75115", percentage: 0.1, band: "outer" },
  { zip: "75116", percentage: 0.1, band: "outer" },
  { zip: "75119", percentage: null, band: "manual_review" },
  { zip: "75125", percentage: null, band: "manual_review" },
  { zip: "75126", percentage: null, band: "manual_review" },
  { zip: "75132", percentage: 0.1, band: "outer" },
  { zip: "75134", percentage: 0.1, band: "outer" },
  { zip: "75135", percentage: null, band: "manual_review" },
  { zip: "75137", percentage: 0.1, band: "outer" },
  { zip: "75141", percentage: 0.1, band: "outer" },
  { zip: "75142", percentage: null, band: "manual_review" },
  { zip: "75143", percentage: null, band: "manual_review" },
  { zip: "75146", percentage: null, band: "manual_review" },
  { zip: "75149", percentage: 0.1, band: "outer" },
  { zip: "75150", percentage: 0.06, band: "extended" },
  { zip: "75152", percentage: null, band: "manual_review" },
  { zip: "75154", percentage: null, band: "manual_review" },
  { zip: "75157", percentage: null, band: "manual_review" },
  { zip: "75158", percentage: null, band: "manual_review" },
  { zip: "75159", percentage: null, band: "manual_review" },
  { zip: "75160", percentage: null, band: "manual_review" },
  { zip: "75161", percentage: null, band: "manual_review" },
  { zip: "75164", percentage: null, band: "manual_review" },
  { zip: "75165", percentage: null, band: "manual_review" },
  { zip: "75166", percentage: 0.1, band: "outer" },
  { zip: "75167", percentage: null, band: "manual_review" },
  { zip: "75172", percentage: null, band: "manual_review" },
  { zip: "75173", percentage: 0.1, band: "outer" },
  { zip: "75180", percentage: 0.1, band: "outer" },
  { zip: "75181", percentage: 0.1, band: "outer" },
  { zip: "75182", percentage: 0.1, band: "outer" },
  { zip: "75189", percentage: null, band: "manual_review" },
  { zip: "75201", percentage: 0.06, band: "extended" },
  { zip: "75202", percentage: 0.06, band: "extended" },
  { zip: "75203", percentage: 0.06, band: "extended" },
  { zip: "75204", percentage: 0.06, band: "extended" },
  { zip: "75205", percentage: 0.06, band: "extended" },
  { zip: "75206", percentage: 0.06, band: "extended" },
  { zip: "75207", percentage: 0.06, band: "extended" },
  { zip: "75208", percentage: 0.06, band: "extended" },
  { zip: "75209", percentage: 0.03, band: "nearby" },
  { zip: "75210", percentage: 0.06, band: "extended" },
  { zip: "75211", percentage: 0.06, band: "extended" },
  { zip: "75212", percentage: 0.06, band: "extended" },
  { zip: "75214", percentage: 0.06, band: "extended" },
  { zip: "75215", percentage: 0.06, band: "extended" },
  { zip: "75216", percentage: 0.1, band: "outer" },
  { zip: "75217", percentage: 0.1, band: "outer" },
  { zip: "75218", percentage: 0.06, band: "extended" },
  { zip: "75219", percentage: 0.06, band: "extended" },
  { zip: "75220", percentage: 0.03, band: "nearby" },
  { zip: "75223", percentage: 0.06, band: "extended" },
  { zip: "75224", percentage: 0.1, band: "outer" },
  { zip: "75225", percentage: 0.03, band: "nearby" },
  { zip: "75226", percentage: 0.06, band: "extended" },
  { zip: "75227", percentage: 0.06, band: "extended" },
  { zip: "75228", percentage: 0.06, band: "extended" },
  { zip: "75229", percentage: 0.03, band: "nearby" },
  { zip: "75230", percentage: 0.03, band: "nearby" },
  { zip: "75231", percentage: 0.03, band: "nearby" },
  { zip: "75232", percentage: 0.1, band: "outer" },
  { zip: "75233", percentage: 0.1, band: "outer" },
  { zip: "75234", percentage: 0.03, band: "nearby" },
  { zip: "75235", percentage: 0.06, band: "extended" },
  { zip: "75236", percentage: 0.1, band: "outer" },
  { zip: "75237", percentage: 0.1, band: "outer" },
  { zip: "75238", percentage: 0.06, band: "extended" },
  { zip: "75240", percentage: 0.03, band: "nearby" },
  { zip: "75241", percentage: 0.1, band: "outer" },
  { zip: "75243", percentage: 0.03, band: "nearby" },
  { zip: "75244", percentage: 0.03, band: "nearby" },
  { zip: "75246", percentage: 0.06, band: "extended" },
  { zip: "75247", percentage: 0.06, band: "extended" },
  { zip: "75248", percentage: 0.03, band: "nearby" },
  { zip: "75249", percentage: 0.1, band: "outer" },
  { zip: "75251", percentage: 0.03, band: "nearby" },
  { zip: "75252", percentage: 0.03, band: "nearby" },
  { zip: "75253", percentage: 0.1, band: "outer" },
  { zip: "75254", percentage: 0.03, band: "nearby" },
  { zip: "75261", percentage: 0.03, band: "nearby" },
  { zip: "75270", percentage: 0.06, band: "extended" },
  { zip: "75287", percentage: 0, band: "core" },
  { zip: "75390", percentage: 0.06, band: "extended" },
  { zip: "75401", percentage: null, band: "manual_review" },
  { zip: "75402", percentage: null, band: "manual_review" },
  { zip: "75407", percentage: 0.1, band: "outer" },
  { zip: "75409", percentage: 0.1, band: "outer" },
  { zip: "75422", percentage: null, band: "manual_review" },
  { zip: "75423", percentage: null, band: "manual_review" },
  { zip: "75424", percentage: null, band: "manual_review" },
  { zip: "75428", percentage: null, band: "manual_review" },
  { zip: "75429", percentage: null, band: "manual_review" },
  { zip: "75442", percentage: 0.1, band: "outer" },
  { zip: "75453", percentage: null, band: "manual_review" },
  { zip: "75454", percentage: 0.06, band: "extended" },
  { zip: "75474", percentage: null, band: "manual_review" },
  { zip: "75496", percentage: null, band: "manual_review" },
  { zip: "76001", percentage: 0.1, band: "outer" },
  { zip: "76002", percentage: 0.1, band: "outer" },
  { zip: "76005", percentage: 0.06, band: "extended" },
  { zip: "76006", percentage: 0.06, band: "extended" },
  { zip: "76008", percentage: null, band: "manual_review" },
  { zip: "76009", percentage: null, band: "manual_review" },
  { zip: "76010", percentage: 0.1, band: "outer" },
  { zip: "76011", percentage: 0.06, band: "extended" },
  { zip: "76012", percentage: 0.1, band: "outer" },
  { zip: "76013", percentage: 0.1, band: "outer" },
  { zip: "76014", percentage: 0.1, band: "outer" },
  { zip: "76015", percentage: 0.1, band: "outer" },
  { zip: "76016", percentage: 0.1, band: "outer" },
  { zip: "76017", percentage: 0.1, band: "outer" },
  { zip: "76018", percentage: 0.1, band: "outer" },
  { zip: "76020", percentage: null, band: "manual_review" },
  { zip: "76021", percentage: 0.06, band: "extended" },
  { zip: "76022", percentage: 0.06, band: "extended" },
  { zip: "76023", percentage: null, band: "manual_review" },
  { zip: "76028", percentage: null, band: "manual_review" },
  { zip: "76031", percentage: null, band: "manual_review" },
  { zip: "76033", percentage: null, band: "manual_review" },
  { zip: "76034", percentage: 0.06, band: "extended" },
  { zip: "76035", percentage: null, band: "manual_review" },
  { zip: "76036", percentage: null, band: "manual_review" },
  { zip: "76039", percentage: 0.06, band: "extended" },
  { zip: "76040", percentage: 0.06, band: "extended" },
  { zip: "76041", percentage: null, band: "manual_review" },
  { zip: "76044", percentage: null, band: "manual_review" },
  { zip: "76050", percentage: null, band: "manual_review" },
  { zip: "76051", percentage: 0.03, band: "nearby" },
  { zip: "76052", percentage: 0.1, band: "outer" },
  { zip: "76053", percentage: 0.06, band: "extended" },
  { zip: "76054", percentage: 0.06, band: "extended" },
  { zip: "76058", percentage: null, band: "manual_review" },
  { zip: "76059", percentage: null, band: "manual_review" },
  { zip: "76060", percentage: null, band: "manual_review" },
  { zip: "76061", percentage: null, band: "manual_review" },
  { zip: "76063", percentage: null, band: "manual_review" },
  { zip: "76064", percentage: null, band: "manual_review" },
  { zip: "76065", percentage: null, band: "manual_review" },
  { zip: "76066", percentage: null, band: "manual_review" },
  { zip: "76071", percentage: 0.1, band: "outer" },
  { zip: "76073", percentage: null, band: "manual_review" },
  { zip: "76078", percentage: 0.1, band: "outer" },
  { zip: "76082", percentage: null, band: "manual_review" },
  { zip: "76084", percentage: null, band: "manual_review" },
  { zip: "76085", percentage: null, band: "manual_review" },
  { zip: "76086", percentage: null, band: "manual_review" },
  { zip: "76087", percentage: null, band: "manual_review" },
  { zip: "76088", percentage: null, band: "manual_review" },
  { zip: "76092", percentage: 0.03, band: "nearby" },
  { zip: "76093", percentage: null, band: "manual_review" },
  { zip: "76102", percentage: 0.1, band: "outer" },
  { zip: "76103", percentage: 0.1, band: "outer" },
  { zip: "76104", percentage: 0.1, band: "outer" },
  { zip: "76105", percentage: 0.1, band: "outer" },
  { zip: "76106", percentage: 0.1, band: "outer" },
  { zip: "76107", percentage: null, band: "manual_review" },
  { zip: "76108", percentage: null, band: "manual_review" },
  { zip: "76109", percentage: null, band: "manual_review" },
  { zip: "76110", percentage: null, band: "manual_review" },
  { zip: "76111", percentage: 0.1, band: "outer" },
  { zip: "76112", percentage: 0.1, band: "outer" },
  { zip: "76114", percentage: null, band: "manual_review" },
  { zip: "76115", percentage: null, band: "manual_review" },
  { zip: "76116", percentage: null, band: "manual_review" },
  { zip: "76117", percentage: 0.1, band: "outer" },
  { zip: "76118", percentage: 0.06, band: "extended" },
  { zip: "76119", percentage: 0.1, band: "outer" },
  { zip: "76120", percentage: 0.1, band: "outer" },
  { zip: "76123", percentage: null, band: "manual_review" },
  { zip: "76126", percentage: null, band: "manual_review" },
  { zip: "76127", percentage: null, band: "manual_review" },
  { zip: "76129", percentage: null, band: "manual_review" },
  { zip: "76131", percentage: 0.1, band: "outer" },
  { zip: "76132", percentage: null, band: "manual_review" },
  { zip: "76133", percentage: null, band: "manual_review" },
  { zip: "76134", percentage: null, band: "manual_review" },
  { zip: "76135", percentage: null, band: "manual_review" },
  { zip: "76137", percentage: 0.1, band: "outer" },
  { zip: "76140", percentage: null, band: "manual_review" },
  { zip: "76148", percentage: 0.06, band: "extended" },
  { zip: "76155", percentage: 0.06, band: "extended" },
  { zip: "76164", percentage: 0.1, band: "outer" },
  { zip: "76177", percentage: 0.06, band: "extended" },
  { zip: "76179", percentage: 0.1, band: "outer" },
  { zip: "76180", percentage: 0.06, band: "extended" },
  { zip: "76182", percentage: 0.06, band: "extended" },
  { zip: "76201", percentage: 0.06, band: "extended" },
  { zip: "76203", percentage: 0.06, band: "extended" },
  { zip: "76205", percentage: 0.03, band: "nearby" },
  { zip: "76207", percentage: 0.06, band: "extended" },
  { zip: "76208", percentage: 0.03, band: "nearby" },
  { zip: "76209", percentage: 0.03, band: "nearby" },
  { zip: "76210", percentage: 0.03, band: "nearby" },
  { zip: "76225", percentage: null, band: "manual_review" },
  { zip: "76226", percentage: 0.03, band: "nearby" },
  { zip: "76227", percentage: 0.03, band: "nearby" },
  { zip: "76234", percentage: null, band: "manual_review" },
  { zip: "76244", percentage: 0.06, band: "extended" },
  { zip: "76247", percentage: 0.06, band: "extended" },
  { zip: "76248", percentage: 0.06, band: "extended" },
  { zip: "76249", percentage: 0.1, band: "outer" },
  { zip: "76258", percentage: 0.06, band: "extended" },
  { zip: "76259", percentage: 0.06, band: "extended" },
  { zip: "76262", percentage: 0.06, band: "extended" },
  { zip: "76266", percentage: 0.1, band: "outer" },
  { zip: "76267", percentage: null, band: "manual_review" },
  { zip: "76426", percentage: null, band: "manual_review" },
  { zip: "76431", percentage: null, band: "manual_review" },
  { zip: "76439", percentage: null, band: "manual_review" },
  { zip: "76487", percentage: null, band: "manual_review" },
  { zip: "76490", percentage: null, band: "manual_review" },
  { zip: "76623", percentage: null, band: "manual_review" },
  { zip: "76651", percentage: null, band: "manual_review" },
  { zip: "76670", percentage: null, band: "manual_review" },
];

/**
 * Deterministic: the same ZIP always resolves to the same result for a
 * given config — never a per-customer or per-call variation. Three
 * distinct outcomes, kept semantically separate so a known DFW ZIP that's
 * simply out of automatic range can be told apart from a ZIP that was never
 * approved at all:
 *
 * 1. Configured automatic band (core/nearby/extended/outer) — a percentage.
 * 2. Known ZIP explicitly assigned "Manual review" in the approved CSV —
 *    `ZIP_MANUAL_REVIEW_REQUIRED`, never an invented percentage.
 * 3. ZIP absent from the approved table entirely — `ZIP_TRAVEL_NOT_CONFIGURED`.
 */
export function getZipTravelRule(
  zip: string,
  config: ZipTravelRule[] = ZIP_TRAVEL_CONFIG
): ZipTravelLookupResult {
  const match = config.find((rule) => rule.zip === zip);
  if (!match) {
    return { configured: false, reason: "ZIP_TRAVEL_NOT_CONFIGURED" };
  }
  if (match.band === "manual_review") {
    return { configured: false, reason: "ZIP_MANUAL_REVIEW_REQUIRED", band: "manual_review" };
  }
  return { configured: true, percentage: match.percentage as number, band: match.band };
}
