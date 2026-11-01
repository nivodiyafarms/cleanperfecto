/**
 * Domain types for the Google Business Profile reviews feature. Field
 * shapes here mirror the Business Profile API v4
 * (mybusiness.googleapis.com/v4/{parent=accounts/*\/locations/*}/reviews)
 * Review resource and ListReviewsResponse, confirmed against
 * developers.google.com on 2026-10-24 — reconfirm once real API access is
 * granted, since Google can change this shape.
 */

export type GoogleStarRating = 1 | 2 | 3 | 4 | 5;

export interface RawGoogleReview {
  googleReviewId: string;
  reviewerDisplayName: string;
  reviewerPhotoUrl: string | null;
  starRating: GoogleStarRating;
  reviewText: string | null;
  createTime: string;
  updateTime: string;
}

export interface FetchAllReviewsResult {
  /** Reviews with a recognized star rating. Only these are upserted. */
  reviews: RawGoogleReview[];
  /** Every well-formed id from the complete fetch, including skipped reviews. Reconciliation uses this list, not `reviews`. */
  fetchedReviewIds: string[];
  /** Ids present in the fetch whose star rating was missing or unrecognized. Not deleted, not refreshed, not displayed. */
  skippedReviewIds: string[];
  averageRating: number;
  totalReviewCount: number;
  /**
   * True only after a complete, well-formed fetch whose id list and
   * totalReviewCount are both exactly zero. The database refuses to
   * delete every cached review unless this is true.
   */
  confirmEmptyReconciliation: boolean;
}

/** A row as cached in google_business_profile_reviews. */
export interface CachedGoogleReview {
  id: string;
  googleReviewId: string;
  reviewerDisplayName: string;
  reviewerPhotoUrl: string | null;
  starRating: GoogleStarRating;
  reviewText: string | null;
  reviewCreatedAt: string;
  reviewUpdatedAt: string;
  firstSyncedAt: string;
  lastSeenAt: string;
}

/** The only fields a public (homepage) reader is ever allowed to select. */
export interface PublicFeaturedReview {
  id: string;
  displayOrder: number;
  reviewerDisplayName: string;
  reviewerPhotoUrl: string | null;
  starRating: GoogleStarRating;
  reviewText: string | null;
  reviewCreatedAt: string;
}

export interface GoogleReviewsSyncState {
  overallRating: number | null;
  totalReviewCount: number | null;
  lastSuccessfulSyncAt: string | null;
  lastSyncAttemptAt: string | null;
  lastSyncError: string | null;
}

/** What the homepage is allowed to see — null (not an error) once last_successful_sync_at itself has aged past the retention window; see public_google_business_profile_rating view. */
export interface PublicGoogleRatingSummary {
  overallRating: number;
  totalReviewCount: number;
}

export interface SyncGoogleReviewsResult {
  outcome: "synced" | "fetch_failed" | "superseded";
  reviewsFetched: number;
  reviewsUpserted: number;
  reviewsSkipped: number;
  reviewsDeletedByReconciliation: number;
  reviewsDeletedByRetentionExpiry: number;
  /** Bounded error code, present only when outcome is fetch_failed. */
  error?: string;
}
