import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { boundSyncErrorCode } from "./errors";
import type { CachedGoogleReview, GoogleReviewsSyncState, PublicFeaturedReview, PublicGoogleRatingSummary, RawGoogleReview } from "./types";

export interface GoogleReviewsSyncWrite {
  reviews: RawGoogleReview[];
  fetchedReviewIds: string[];
  skippedReviewIds: string[];
  overallRating: number;
  totalReviewCount: number;
}

export const GOOGLE_REVIEWS_SYNC_SUPERSEDED_MARKER = "google_reviews_sync_superseded";

export interface GoogleReviewsRepository {
  getAllCachedReviews(): Promise<CachedGoogleReview[]>;
  deleteReviewsByIds(ids: string[]): Promise<number>;
  /**
   * Upserts validated reviews, unfeatures skipped ids without refreshing
   * them, deletes cached reviews absent from the complete fetched-id list,
   * and records the aggregate — all in one transaction (see
   * apply_google_reviews_sync()). Throws an error whose message contains
   * GOOGLE_REVIEWS_SYNC_SUPERSEDED_MARKER when a sync that started later
   * than `syncStartedAt` already committed. Resolves to the number of
   * cached reviews removed by reconciliation.
   */
  applySyncResult(syncStartedAt: Date, write: GoogleReviewsSyncWrite): Promise<number>;
  recordSyncFailure(now: Date, error: string): Promise<void>;
  /** Unfiltered, true sync state — admin diagnostics only. Never used by the homepage. */
  getSyncState(): Promise<GoogleReviewsSyncState>;
  /** Google's own aggregate, or null once it's past the retention window — see public_google_business_profile_rating view. The homepage's only source for rating/count. */
  getPublicRatingSummary(): Promise<PublicGoogleRatingSummary | null>;
  /** Featured reviews, excluding any whose cache row has aged past the retention window — see public_featured_google_reviews view. The homepage's only source for cards. */
  getFeaturedReviews(): Promise<PublicFeaturedReview[]>;
  getFeaturedReviewSelections(): Promise<{ reviewId: string; displayOrder: number }[]>;
  setFeaturedReviews(selections: { reviewId: string; displayOrder: number }[]): Promise<void>;
}

type SupabaseAdminClient = ReturnType<typeof createSupabaseAdminClient>;

function toCachedReview(row: Record<string, unknown>): CachedGoogleReview {
  return {
    id: row.id as string,
    googleReviewId: row.google_review_id as string,
    reviewerDisplayName: row.reviewer_display_name as string,
    reviewerPhotoUrl: (row.reviewer_photo_url as string | null) ?? null,
    starRating: row.star_rating as CachedGoogleReview["starRating"],
    reviewText: (row.review_text as string | null) ?? null,
    reviewCreatedAt: row.review_created_at as string,
    reviewUpdatedAt: row.review_updated_at as string,
    firstSyncedAt: row.first_synced_at as string,
    lastSeenAt: row.last_seen_at as string,
  };
}

/**
 * Real, Supabase-backed implementation. The two "public" methods read
 * from the public_* views (never the raw tables) so expired content is
 * excluded at the query layer itself, not just by app-level filtering —
 * see the views' own comments in 20261024091500_...sql for why.
 */
export function createSupabaseGoogleReviewsRepository(client: SupabaseAdminClient = createSupabaseAdminClient()): GoogleReviewsRepository {
  return {
    async getAllCachedReviews(): Promise<CachedGoogleReview[]> {
      const { data, error } = await client
        .from("google_business_profile_reviews")
        .select("id, google_review_id, reviewer_display_name, reviewer_photo_url, star_rating, review_text, review_created_at, review_updated_at, first_synced_at, last_seen_at");
      if (error) throw new Error(`[google-reviews] getAllCachedReviews failed: ${error.message}`);
      return (data ?? []).map(toCachedReview);
    },

    async deleteReviewsByIds(ids) {
      if (ids.length === 0) return 0;
      const { error, count } = await client.from("google_business_profile_reviews").delete({ count: "exact" }).in("id", ids);
      if (error) throw new Error(`[google-reviews] deleteReviewsByIds failed: ${error.message}`);
      return count ?? 0;
    },

    async applySyncResult(syncStartedAt, write) {
      const { data, error } = await client.rpc("apply_google_reviews_sync", {
        p_sync_started_at: syncStartedAt.toISOString(),
        p_reviews: write.reviews.map((review) => ({
          googleReviewId: review.googleReviewId,
          reviewerDisplayName: review.reviewerDisplayName,
          reviewerPhotoUrl: review.reviewerPhotoUrl,
          starRating: review.starRating,
          reviewText: review.reviewText,
          createTime: review.createTime,
          updateTime: review.updateTime,
        })),
        p_fetched_review_ids: write.fetchedReviewIds,
        p_overall_rating: write.overallRating,
        p_total_review_count: write.totalReviewCount,
      });
      if (error) throw new Error(`[google-reviews] applySyncResult failed: ${error.message}`);
      return (data as number | null) ?? 0;
    },

    async recordSyncFailure(now, syncError) {
      const { error } = await client
        .from("google_business_profile_sync_state")
        .update({ last_sync_attempt_at: now.toISOString(), last_sync_error: boundSyncErrorCode(syncError) })
        .eq("id", 1);
      if (error) throw new Error(`[google-reviews] recordSyncFailure failed: ${error.message}`);
    },

    async getSyncState() {
      const { data, error } = await client
        .from("google_business_profile_sync_state")
        .select("overall_rating, total_review_count, last_successful_sync_at, last_sync_attempt_at, last_sync_error")
        .eq("id", 1)
        .single();
      if (error) throw new Error(`[google-reviews] getSyncState failed: ${error.message}`);
      return {
        overallRating: data.overall_rating,
        totalReviewCount: data.total_review_count,
        lastSuccessfulSyncAt: data.last_successful_sync_at,
        lastSyncAttemptAt: data.last_sync_attempt_at,
        lastSyncError: data.last_sync_error,
      };
    },

    async getPublicRatingSummary() {
      const { data, error } = await client.from("public_google_business_profile_rating").select("overall_rating, total_review_count").maybeSingle();
      if (error) throw new Error(`[google-reviews] getPublicRatingSummary failed: ${error.message}`);
      if (!data || data.overall_rating === null || data.total_review_count === null) return null;
      return { overallRating: data.overall_rating, totalReviewCount: data.total_review_count };
    },

    async getFeaturedReviews() {
      const { data, error } = await client
        .from("public_featured_google_reviews")
        .select("id, display_order, reviewer_display_name, reviewer_photo_url, star_rating, review_text, review_created_at")
        .order("display_order", { ascending: true });
      if (error) throw new Error(`[google-reviews] getFeaturedReviews failed: ${error.message}`);

      return (data ?? []).map(
        (row): PublicFeaturedReview => ({
          id: row.id,
          displayOrder: row.display_order,
          reviewerDisplayName: row.reviewer_display_name,
          reviewerPhotoUrl: row.reviewer_photo_url,
          starRating: row.star_rating,
          reviewText: row.review_text,
          reviewCreatedAt: row.review_created_at,
        })
      );
    },

    async getFeaturedReviewSelections() {
      const { data, error } = await client.from("featured_google_reviews").select("review_id, display_order").order("display_order", { ascending: true });
      if (error) throw new Error(`[google-reviews] getFeaturedReviewSelections failed: ${error.message}`);
      return (data ?? []).map((row) => ({ reviewId: row.review_id as string, displayOrder: row.display_order as number }));
    },

    async setFeaturedReviews(selections) {
      const { error } = await client.rpc("set_featured_google_reviews", {
        p_selections: selections.map((selection) => ({ reviewId: selection.reviewId, displayOrder: selection.displayOrder })),
      });
      if (error) throw new Error(`[google-reviews] setFeaturedReviews failed: ${error.message}`);
    },
  };
}
