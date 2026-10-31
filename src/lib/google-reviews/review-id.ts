const BARE_REVIEW_ID = /^[A-Za-z0-9_-]{1,512}$/;

/**
 * Accepts the bare review id Google returns, or the same id as the final
 * segment of a reviews resource name. Null, blank, and any other shape are
 * rejected so reconciliation cannot run on a missing id.
 */
export function normalizeGoogleReviewId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const marker = "/reviews/";
  const bare = trimmed.includes(marker) ? trimmed.slice(trimmed.lastIndexOf(marker) + marker.length) : trimmed;
  if (!BARE_REVIEW_ID.test(bare)) return null;
  return bare;
}
