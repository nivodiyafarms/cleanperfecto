import { boundSyncErrorCode } from "../errors";
import { normalizeGoogleReviewId } from "../review-id";
import { GOOGLE_REVIEWS_SYNC_SUPERSEDED_MARKER, type GoogleReviewsRepository, type GoogleReviewsSyncWrite } from "../repository";
import type { CachedGoogleReview, GoogleReviewsSyncState, PublicFeaturedReview, PublicGoogleRatingSummary } from "../types";

const RETENTION_DAYS_FOR_PUBLIC_VIEWS = 30;

/**
 * In-memory stand-in for unit tests only — never used by any production
 * code path. Mimics the real schema's two load-bearing properties so
 * sync.ts's control flow is meaningfully exercised without a real
 * Postgres instance:
 *   - applySyncResult is all-or-nothing (throws before mutating anything
 *     on a "supersede" and never partially applies), mirroring the
 *     apply_google_reviews_sync() transaction.
 *   - getPublicRatingSummary/getFeaturedReviews apply the same 30-day
 *     retention filter the public_* views enforce in real Postgres.
 */
export function createFakeGoogleReviewsRepository(initial?: { reviews?: CachedGoogleReview[] }): GoogleReviewsRepository & {
  _reviews: CachedGoogleReview[];
  failNextSetFeaturedReviews: () => void;
} {
  const reviews: CachedGoogleReview[] = initial?.reviews ? [...initial.reviews] : [];
  let featured: { reviewId: string; displayOrder: number }[] = [];
  let syncState: GoogleReviewsSyncState = {
    overallRating: null,
    totalReviewCount: null,
    lastSuccessfulSyncAt: null,
    lastSyncAttemptAt: null,
    lastSyncError: null,
  };
  let nextId = 1;
  let failNextSet = false;

  function isWithinRetention(iso: string, now: Date): boolean {
    const cutoffMs = now.getTime() - RETENTION_DAYS_FOR_PUBLIC_VIEWS * 24 * 60 * 60 * 1000;
    return new Date(iso).getTime() >= cutoffMs;
  }

  return {
    _reviews: reviews,
    failNextSetFeaturedReviews() {
      failNextSet = true;
    },

    async getAllCachedReviews() {
      return [...reviews];
    },

    async deleteReviewsByIds(ids) {
      const before = reviews.length;
      const keep = reviews.filter((r) => !ids.includes(r.id));
      reviews.length = 0;
      reviews.push(...keep);
      featured = featured.filter((f) => keep.some((r) => r.id === f.reviewId));
      return before - reviews.length;
    },

    async applySyncResult(syncStartedAt, write) {
      if (syncState.lastSuccessfulSyncAt && new Date(syncState.lastSuccessfulSyncAt).getTime() > syncStartedAt.getTime()) {
        throw new Error(GOOGLE_REVIEWS_SYNC_SUPERSEDED_MARKER);
      }
      assertSyncWrite(write);

      const nextReviews = reviews.map((review) => ({ ...review }));
      for (const review of write.reviews) {
        const existingIndex = nextReviews.findIndex((cached) => cached.googleReviewId === review.googleReviewId);
        if (existingIndex >= 0) {
          const existing = nextReviews[existingIndex];
          nextReviews[existingIndex] = {
            ...existing,
            reviewerDisplayName: review.reviewerDisplayName,
            reviewerPhotoUrl: review.reviewerPhotoUrl,
            starRating: review.starRating,
            reviewText: review.reviewText,
            reviewUpdatedAt: review.updateTime,
            lastSeenAt: syncStartedAt.toISOString(),
          };
        } else {
          nextReviews.push({
            id: `fake-${nextId++}`,
            googleReviewId: review.googleReviewId,
            reviewerDisplayName: review.reviewerDisplayName,
            reviewerPhotoUrl: review.reviewerPhotoUrl,
            starRating: review.starRating,
            reviewText: review.reviewText,
            reviewCreatedAt: review.createTime,
            reviewUpdatedAt: review.updateTime,
            firstSyncedAt: syncStartedAt.toISOString(),
            lastSeenAt: syncStartedAt.toISOString(),
          });
        }
      }

      const fetchedIds = new Set(write.fetchedReviewIds);
      const kept = nextReviews.filter((review) => fetchedIds.has(review.googleReviewId));
      const reconciledCount = nextReviews.length - kept.length;
      const keptIds = new Set(kept.map((review) => review.id));
      const skippedIds = new Set(write.skippedReviewIds);

      reviews.length = 0;
      reviews.push(...kept);
      featured = featured.filter((selection) => {
        const review = kept.find((cached) => cached.id === selection.reviewId);
        if (!review || !keptIds.has(review.id)) return false;
        return !skippedIds.has(review.googleReviewId);
      });

      syncState = {
        overallRating: write.overallRating,
        totalReviewCount: write.totalReviewCount,
        lastSuccessfulSyncAt: syncStartedAt.toISOString(),
        lastSyncAttemptAt: syncStartedAt.toISOString(),
        lastSyncError: null,
      };

      return reconciledCount;
    },

    async recordSyncFailure(now, error) {
      syncState = { ...syncState, lastSyncAttemptAt: now.toISOString(), lastSyncError: boundSyncErrorCode(error) };
    },

    async getSyncState() {
      return syncState;
    },

    async getPublicRatingSummary(): Promise<PublicGoogleRatingSummary | null> {
      if (syncState.overallRating === null || syncState.totalReviewCount === null || !syncState.lastSuccessfulSyncAt) return null;
      if (!isWithinRetention(syncState.lastSuccessfulSyncAt, new Date())) return null;
      return { overallRating: syncState.overallRating, totalReviewCount: syncState.totalReviewCount };
    },

    async getFeaturedReviews() {
      const now = new Date();
      return featured
        .map((f) => {
          const review = reviews.find((r) => r.id === f.reviewId);
          if (!review || !isWithinRetention(review.lastSeenAt, now)) return null;
          const result: PublicFeaturedReview = {
            id: review.id,
            displayOrder: f.displayOrder,
            reviewerDisplayName: review.reviewerDisplayName,
            reviewerPhotoUrl: review.reviewerPhotoUrl,
            starRating: review.starRating,
            reviewText: review.reviewText,
            reviewCreatedAt: review.reviewCreatedAt,
          };
          return result;
        })
        .filter((r): r is PublicFeaturedReview => r !== null)
        .sort((a, b) => a.displayOrder - b.displayOrder);
    },

    async getFeaturedReviewSelections() {
      return [...featured];
    },

    async setFeaturedReviews(selections) {
      if (failNextSet) {
        failNextSet = false;
        throw new Error("featured_reviews_failed");
      }
      const next = selections.map((selection) => ({ ...selection }));
      featured = next;
    },
  };
}

function assertSyncWrite(write: GoogleReviewsSyncWrite): void {
  if (write.fetchedReviewIds.some((id) => normalizeGoogleReviewId(id) !== id)) {
    throw new Error("google_reviews_malformed_review_id");
  }
  const fetched = new Set(write.fetchedReviewIds);
  const valid = new Set(write.reviews.map((review) => review.googleReviewId));
  for (const review of write.reviews) {
    if (!fetched.has(review.googleReviewId)) throw new Error("google_reviews_malformed_review_id");
  }
  for (const skippedId of write.skippedReviewIds) {
    if (!fetched.has(skippedId) || valid.has(skippedId)) throw new Error("google_reviews_malformed_review_id");
  }
}
