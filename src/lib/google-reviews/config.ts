import "server-only";

/**
 * All Google Business Profile credentials/identifiers, read the same way
 * every other server-side secret in this codebase is (plain env vars —
 * see STRIPE_SECRET_KEY, RESEND_API_KEY). Supabase Vault was considered and
 * rejected for this: in this repo Vault only ever holds secrets consumed
 * *inside Postgres* by pg_net for the cron HTTP call itself (see
 * 20260826090200_enable_pg_cron_and_pg_net_for_notification_dispatch.sql) —
 * every secret the Next.js server process needs to read itself already
 * goes through process.env, and OAuth tokens are exactly that case.
 */
export interface GoogleBusinessProfileConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  /** Bare account id, with exactly one `accounts/` prefix applied at the URL boundary. */
  accountId: string;
  /** Bare location id, with exactly one `locations/` prefix applied at the URL boundary. */
  locationId: string;
}

const BARE_RESOURCE_ID = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * Accepts `123` or `accounts/123` (and the locations equivalent). Strips
 * the matching prefix at most once. A doubled prefix, the wrong prefix, or
 * any extra path segment is rejected rather than normalized into a path.
 */
export function normalizeGoogleResourceId(value: string, kind: "account" | "location"): string | null {
  const prefix = kind === "account" ? "accounts/" : "locations/";
  const trimmed = value.trim();
  if (!trimmed) return null;

  const bare = trimmed.startsWith(prefix) ? trimmed.slice(prefix.length) : trimmed;
  if (trimmed.startsWith(prefix) ? bare.includes("/") || bare.startsWith(prefix) : trimmed.includes("/")) {
    return null;
  }
  if (!BARE_RESOURCE_ID.test(bare)) return null;
  return bare;
}

/** Builds the reviews.list URL from already-normalized bare ids. Returns null if either id would create a doubled or extra path segment. */
export function googleBusinessProfileReviewsUrl(accountId: string, locationId: string): string | null {
  if (normalizeGoogleResourceId(accountId, "account") !== accountId) return null;
  if (normalizeGoogleResourceId(locationId, "location") !== locationId) return null;
  return `https://mybusiness.googleapis.com/v4/accounts/${accountId}/locations/${locationId}/reviews`;
}

function readRequiredEnv(name: string): string | null {
  const value = process.env[name];
  if (!value || !value.trim()) return null;
  return value.trim();
}

/**
 * Returns null — never throws, never a partial config — unless every
 * credential is present. Callers (the cron route, the admin "sync status"
 * display) use this to refuse to run rather than attempting a call that
 * can only fail, per "do not enable the scheduled sync until credentials
 * are configured."
 */
export function getGoogleBusinessProfileConfig(): GoogleBusinessProfileConfig | null {
  const clientId = readRequiredEnv("GOOGLE_BUSINESS_PROFILE_CLIENT_ID");
  const clientSecret = readRequiredEnv("GOOGLE_BUSINESS_PROFILE_CLIENT_SECRET");
  const refreshToken = readRequiredEnv("GOOGLE_BUSINESS_PROFILE_REFRESH_TOKEN");
  const accountRaw = readRequiredEnv("GOOGLE_BUSINESS_PROFILE_ACCOUNT_ID");
  const locationRaw = readRequiredEnv("GOOGLE_BUSINESS_PROFILE_LOCATION_ID");
  const accountId = accountRaw ? normalizeGoogleResourceId(accountRaw, "account") : null;
  const locationId = locationRaw ? normalizeGoogleResourceId(locationRaw, "location") : null;

  if (!clientId || !clientSecret || !refreshToken || !accountId || !locationId) {
    return null;
  }
  return { clientId, clientSecret, refreshToken, accountId, locationId };
}

/**
 * The public "See all reviews on Google" destination — deliberately a
 * separate env var from GOOGLE_REVIEW_URL, which exists for a different
 * purpose entirely: inviting a customer who just finished service to leave
 * a brand-new review (src/lib/notifications/google-review-url.ts). Google's
 * "write a review" short link and a listing's general Maps URL are
 * different URLs; conflating them would send homepage visitors who just
 * want to read reviews into the write-a-review flow instead.
 */
export function getGoogleReviewsListingUrl(): string | null {
  const configured = process.env.GOOGLE_BUSINESS_PROFILE_LISTING_URL;
  if (!configured || !configured.trim()) return null;
  return configured.trim();
}

/**
 * Conservative content-retention cap. Google's review content must not be
 * cached indefinitely — this enforces an upper bound on how long a review
 * can sit in google_business_profile_reviews without a sync re-confirming
 * it's still returned by Google, so content still expires on schedule even
 * if the daily sync stops running or Google authorization is revoked (see
 * retention.ts). 30 days is a deliberately conservative placeholder;
 * confirm against the Business Profile API's current Terms of Service
 * once real API access is granted, and adjust this single constant if
 * those terms specify a different number.
 */
export const GOOGLE_REVIEW_CONTENT_RETENTION_DAYS = 30;
