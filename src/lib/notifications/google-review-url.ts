/**
 * The destination for review_request notifications — environment
 * configuration, never a hardcoded/temporary Google Maps share URL (which
 * tends to rot). Returns null when unset/blank so callers can fail safe
 * (never enqueue, never send a broken or missing link) rather than
 * inventing a fallback URL. The real production value is configured
 * separately before activation; local/disposable environments use a
 * harmless placeholder.
 */
export function getGoogleReviewUrl(): string | null {
  const configured = process.env.GOOGLE_REVIEW_URL;
  if (!configured || !configured.trim()) return null;
  return configured.trim();
}
