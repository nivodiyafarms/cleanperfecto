/**
 * Pure decision function: which cached review ids have fallen outside the
 * content-retention window. Deliberately independent of whether any fetch
 * succeeded — this is the mechanism that makes content expire even when
 * syncing has stopped entirely (credentials revoked, sync disabled, Google
 * API down for an extended period) rather than only when Google explicitly
 * stops returning a review.
 */
export function selectExpiredReviewIds(reviews: { id: string; lastSeenAt: string }[], now: Date, retentionDays: number): string[] {
  const cutoffMs = now.getTime() - retentionDays * 24 * 60 * 60 * 1000;
  return reviews.filter((review) => new Date(review.lastSeenAt).getTime() < cutoffMs).map((review) => review.id);
}

/**
 * A review may be featured only when the latest successful sync validated
 * it and that confirmation is still inside the retention window. A skipped
 * or stale row keeps its previous text but is not eligible.
 */
export function isReviewEligibleForFeaturing(
  review: { lastSeenAt: string },
  lastSuccessfulSyncAt: string | null,
  now: Date,
  retentionDays: number
): boolean {
  if (!lastSuccessfulSyncAt) return false;
  const seenMs = new Date(review.lastSeenAt).getTime();
  const syncedMs = new Date(lastSuccessfulSyncAt).getTime();
  const cutoffMs = now.getTime() - retentionDays * 24 * 60 * 60 * 1000;
  return seenMs >= syncedMs && seenMs >= cutoffMs;
}
