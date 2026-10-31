import "server-only";

import type { GoogleBusinessProfileReviewsClient } from "./client";
import { GOOGLE_REVIEWS_SYNC_SUPERSEDED_MARKER, type GoogleReviewsRepository } from "./repository";
import { GOOGLE_REVIEW_CONTENT_RETENTION_DAYS } from "./config";
import { sanitizeGoogleReviewsError } from "./errors";
import { selectExpiredReviewIds } from "./retention";
import type { SyncGoogleReviewsResult } from "./types";

/**
 * The full daily sync, in one orchestration function so the deletion
 * rules can't accidentally get entangled:
 *
 *  - Deletion-by-reconciliation (a review Google no longer returns) only
 *    ever runs after fetchAllReviews() has resolved successfully AND
 *    inside the same atomic DB transaction as the upsert + aggregate
 *    update (see applySyncResult / apply_google_reviews_sync()) — a
 *    thrown fetch error is caught before applySyncResult is even called,
 *    so a failed/partial fetch can never reconcile or write anything.
 *  - Deletion-by-retention-expiry runs unconditionally, on every path
 *    (success, failure, and superseded), because content must expire on
 *    schedule even if Google sync has stopped working entirely. This is
 *    the app-level, opportunistic half of retention enforcement.
 *    expire_stale_google_reviews() is the database half. Migrations
 *    install that function and do not leave its pg_cron job scheduled —
 *    see docs/google-reviews-activation.md.
 *
 * retentionDays is clamped to never exceed GOOGLE_REVIEW_CONTENT_RETENTION_DAYS
 * (30, Google's own content-policy cap) — callers may only ever shrink the
 * window (e.g. tests), never widen it.
 */
export async function syncGoogleReviews(
  client: GoogleBusinessProfileReviewsClient,
  repo: GoogleReviewsRepository,
  now: Date,
  retentionDays: number = GOOGLE_REVIEW_CONTENT_RETENTION_DAYS
): Promise<SyncGoogleReviewsResult> {
  const effectiveRetentionDays = Math.min(retentionDays, GOOGLE_REVIEW_CONTENT_RETENTION_DAYS);

  let fetchResult;
  try {
    fetchResult = await client.fetchAllReviews();
  } catch (error) {
    const sanitized = sanitizeGoogleReviewsError(error);
    await repo.recordSyncFailure(now, sanitized.message);
    const reviewsDeletedByRetentionExpiry = await runRetentionExpiry(repo, now, effectiveRetentionDays);
    return {
      outcome: "fetch_failed",
      reviewsFetched: 0,
      reviewsUpserted: 0,
      reviewsSkipped: 0,
      reviewsDeletedByReconciliation: 0,
      reviewsDeletedByRetentionExpiry,
      error: sanitized.message,
    };
  }

  let reviewsDeletedByReconciliation: number;
  try {
    reviewsDeletedByReconciliation = await repo.applySyncResult(now, {
      reviews: fetchResult.reviews,
      fetchedReviewIds: fetchResult.fetchedReviewIds,
      skippedReviewIds: fetchResult.skippedReviewIds,
      overallRating: fetchResult.averageRating,
      totalReviewCount: fetchResult.totalReviewCount,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes(GOOGLE_REVIEWS_SYNC_SUPERSEDED_MARKER)) {
      // Not a failure: a newer sync (concurrent run, or this one simply
      // took longer) already committed its result. Nothing to upsert or
      // reconcile from this call — the newer data stands. Retention
      // expiry still runs; it's independent of which sync "won."
      const reviewsDeletedByRetentionExpiry = await runRetentionExpiry(repo, now, effectiveRetentionDays);
      return {
        outcome: "superseded",
        reviewsFetched: fetchResult.fetchedReviewIds.length,
        reviewsUpserted: 0,
        reviewsSkipped: fetchResult.skippedReviewIds.length,
        reviewsDeletedByReconciliation: 0,
        reviewsDeletedByRetentionExpiry,
      };
    }
    // A genuine DB failure during the atomic write. recordSyncFailure is
    // itself a DB write that could fail for the same reason, so there's
    // nothing safe to record here beyond letting this propagate — the
    // cron route surfaces it as a 500, which is the correct loud failure
    // mode for "the database rejected the sync," distinct from "Google
    // couldn't be reached" above.
    throw error;
  }

  const reviewsDeletedByRetentionExpiry = await runRetentionExpiry(repo, now, effectiveRetentionDays);

  return {
    outcome: "synced",
    reviewsFetched: fetchResult.fetchedReviewIds.length,
    reviewsUpserted: fetchResult.reviews.length,
    reviewsSkipped: fetchResult.skippedReviewIds.length,
    reviewsDeletedByReconciliation,
    reviewsDeletedByRetentionExpiry,
  };
}

async function runRetentionExpiry(repo: GoogleReviewsRepository, now: Date, retentionDays: number): Promise<number> {
  const cached = await repo.getAllCachedReviews();
  const expiredIds = selectExpiredReviewIds(cached, now, retentionDays);
  if (expiredIds.length === 0) return 0;
  return repo.deleteReviewsByIds(expiredIds);
}
