import { describe, expect, it } from "vitest";
import { syncGoogleReviews } from "./sync";
import { createFakeGoogleBusinessProfileReviewsClient } from "./test-support/fake-google-business-profile-reviews-client";
import { createFakeGoogleReviewsRepository } from "./test-support/fake-google-reviews-repository";
import type { RawGoogleReview } from "./types";

const now = new Date("2026-10-24T00:00:00Z");

function makeReview(overrides: Partial<RawGoogleReview> = {}): RawGoogleReview {
  return {
    googleReviewId: "g-1",
    reviewerDisplayName: "Jamie Lee",
    reviewerPhotoUrl: null,
    starRating: 5,
    reviewText: "Great clean!",
    createTime: "2026-10-01T00:00:00Z",
    updateTime: "2026-10-01T00:00:00Z",
    ...overrides,
  };
}

describe("syncGoogleReviews", () => {
  it("upserts reviews and records aggregate rating/count on a successful fetch", async () => {
    const client = createFakeGoogleBusinessProfileReviewsClient({
      result: { reviews: [makeReview()], averageRating: 4.8, totalReviewCount: 42 },
    });
    const repo = createFakeGoogleReviewsRepository();

    const result = await syncGoogleReviews(client, repo, now);

    expect(result.outcome).toBe("synced");
    expect(result.reviewsFetched).toBe(1);
    expect(result.reviewsUpserted).toBe(1);
    expect(result.reviewsSkipped).toBe(0);
    expect(await repo.getSyncState()).toMatchObject({ overallRating: 4.8, totalReviewCount: 42, lastSyncError: null });
  });

  it("deletes a cached review no longer returned by Google, after a complete successful fetch, and reports the count", async () => {
    const repo = createFakeGoogleReviewsRepository({
      reviews: [
        {
          id: "cached-1",
          googleReviewId: "gone",
          reviewerDisplayName: "Old Reviewer",
          reviewerPhotoUrl: null,
          starRating: 3,
          reviewText: "ok",
          reviewCreatedAt: "2026-01-01T00:00:00Z",
          reviewUpdatedAt: "2026-01-01T00:00:00Z",
          firstSyncedAt: "2026-01-01T00:00:00Z",
          lastSeenAt: "2026-01-01T00:00:00Z",
        },
      ],
    });
    const client = createFakeGoogleBusinessProfileReviewsClient({
      result: { reviews: [makeReview({ googleReviewId: "still-here" })], averageRating: 5, totalReviewCount: 1 },
    });

    const result = await syncGoogleReviews(client, repo, now);

    expect(result.outcome).toBe("synced");
    expect(result.reviewsDeletedByReconciliation).toBe(1);
    expect((await repo.getAllCachedReviews()).map((r) => r.googleReviewId)).toEqual(["still-here"]);
  });

  it("does not delete any review when the fetch fails (partial/failed fetch never reconciles)", async () => {
    const repo = createFakeGoogleReviewsRepository({
      reviews: [
        {
          id: "cached-1",
          googleReviewId: "still-cached",
          reviewerDisplayName: "Someone",
          reviewerPhotoUrl: null,
          starRating: 4,
          reviewText: "fine",
          reviewCreatedAt: "2026-10-20T00:00:00Z",
          reviewUpdatedAt: "2026-10-20T00:00:00Z",
          firstSyncedAt: "2026-10-20T00:00:00Z",
          lastSeenAt: "2026-10-20T00:00:00Z", // within retention window
        },
      ],
    });
    const client = createFakeGoogleBusinessProfileReviewsClient({ error: new Error("network timeout") });

    const result = await syncGoogleReviews(client, repo, now);

    expect(result.outcome).toBe("fetch_failed");
    expect(result.reviewsDeletedByReconciliation).toBe(0);
    expect(result.reviewsUpserted).toBe(0);
    expect((await repo.getAllCachedReviews()).map((r) => r.googleReviewId)).toEqual(["still-cached"]);
    expect((await repo.getSyncState()).lastSyncError).toBe("network_error");
  });

  it("still runs retention expiry when the fetch fails, so content expires even if syncing has stopped", async () => {
    const repo = createFakeGoogleReviewsRepository({
      reviews: [
        {
          id: "stale-1",
          googleReviewId: "stale",
          reviewerDisplayName: "Stale Reviewer",
          reviewerPhotoUrl: null,
          starRating: 2,
          reviewText: "meh",
          reviewCreatedAt: "2026-01-01T00:00:00Z",
          reviewUpdatedAt: "2026-01-01T00:00:00Z",
          firstSyncedAt: "2026-01-01T00:00:00Z",
          lastSeenAt: "2026-01-01T00:00:00Z", // well past a 30-day retention window
        },
      ],
    });
    const client = createFakeGoogleBusinessProfileReviewsClient({ error: new Error("auth revoked") });

    const result = await syncGoogleReviews(client, repo, now, 30);

    expect(result.outcome).toBe("fetch_failed");
    expect(result.reviewsDeletedByRetentionExpiry).toBe(1);
    expect(await repo.getAllCachedReviews()).toEqual([]);
  });

  it("cascades a retention-expired review out of the featured set", async () => {
    const repo = createFakeGoogleReviewsRepository({
      reviews: [
        {
          id: "stale-1",
          googleReviewId: "stale",
          reviewerDisplayName: "Stale Reviewer",
          reviewerPhotoUrl: null,
          starRating: 5,
          reviewText: "nice",
          reviewCreatedAt: "2026-01-01T00:00:00Z",
          reviewUpdatedAt: "2026-01-01T00:00:00Z",
          firstSyncedAt: "2026-01-01T00:00:00Z",
          lastSeenAt: "2026-01-01T00:00:00Z",
        },
      ],
    });
    await repo.setFeaturedReviews([{ reviewId: "stale-1", displayOrder: 1 }]);
    const client = createFakeGoogleBusinessProfileReviewsClient({ error: new Error("auth revoked") });

    await syncGoogleReviews(client, repo, now, 30);

    expect(await repo.getFeaturedReviews()).toEqual([]);
  });

  it("clamps a retentionDays argument larger than 30 down to 30 — the cap cannot be widened by a caller", async () => {
    const repo = createFakeGoogleReviewsRepository({
      reviews: [
        {
          id: "r-35-days",
          googleReviewId: "g-35",
          reviewerDisplayName: "Someone",
          reviewerPhotoUrl: null,
          starRating: 5,
          reviewText: "x",
          reviewCreatedAt: "2026-01-01T00:00:00Z",
          reviewUpdatedAt: "2026-01-01T00:00:00Z",
          firstSyncedAt: "2026-01-01T00:00:00Z",
          lastSeenAt: new Date(now.getTime() - 35 * 24 * 60 * 60 * 1000).toISOString(),
        },
      ],
    });
    const client = createFakeGoogleBusinessProfileReviewsClient({ error: new Error("down") });

    // Caller asks for a 90-day window; the 30-day Google content-policy cap must win.
    const result = await syncGoogleReviews(client, repo, now, 90);

    expect(result.reviewsDeletedByRetentionExpiry).toBe(1);
  });

  it("stores only a bounded code when the thrown error text contains a credential", async () => {
    const repo = createFakeGoogleReviewsRepository();
    const client = createFakeGoogleBusinessProfileReviewsClient({
      error: new Error("OAuth failed body refresh_token=super-secret-value access_token=also-secret"),
    });

    const result = await syncGoogleReviews(client, repo, now);

    expect(result.outcome).toBe("fetch_failed");
    expect(result.error).toBe("network_error");
    expect(result.error).not.toContain("secret");
    expect((await repo.getSyncState()).lastSyncError).toBe("network_error");
  });

  it("skips an unknown star rating without deleting or refreshing that cached review, and unfeatures it", async () => {
    const repo = createFakeGoogleReviewsRepository({
      reviews: [
        {
          id: "cached-skip",
          googleReviewId: "skipped-1",
          reviewerDisplayName: "Old Name",
          reviewerPhotoUrl: null,
          starRating: 5,
          reviewText: "Old text",
          reviewCreatedAt: "2026-10-01T00:00:00Z",
          reviewUpdatedAt: "2026-10-01T00:00:00Z",
          firstSyncedAt: "2026-10-01T00:00:00Z",
          lastSeenAt: "2026-10-20T00:00:00Z",
        },
        {
          id: "cached-gone",
          googleReviewId: "gone",
          reviewerDisplayName: "Gone",
          reviewerPhotoUrl: null,
          starRating: 4,
          reviewText: "bye",
          reviewCreatedAt: "2026-10-01T00:00:00Z",
          reviewUpdatedAt: "2026-10-01T00:00:00Z",
          firstSyncedAt: "2026-10-01T00:00:00Z",
          lastSeenAt: "2026-10-20T00:00:00Z",
        },
      ],
    });
    await repo.setFeaturedReviews([{ reviewId: "cached-skip", displayOrder: 1 }]);
    const client = createFakeGoogleBusinessProfileReviewsClient({
      result: {
        reviews: [makeReview({ googleReviewId: "kept" })],
        fetchedReviewIds: ["kept", "skipped-1"],
        skippedReviewIds: ["skipped-1"],
        averageRating: 5,
        totalReviewCount: 2,
      },
    });

    const result = await syncGoogleReviews(client, repo, now);

    expect(result).toMatchObject({ outcome: "synced", reviewsFetched: 2, reviewsUpserted: 1, reviewsSkipped: 1, reviewsDeletedByReconciliation: 1 });
    const skipped = (await repo.getAllCachedReviews()).find((review) => review.googleReviewId === "skipped-1");
    expect(skipped).toMatchObject({ reviewerDisplayName: "Old Name", reviewText: "Old text", lastSeenAt: "2026-10-20T00:00:00Z" });
    expect(await repo.getFeaturedReviews()).toEqual([]);
    expect((await repo.getAllCachedReviews()).map((review) => review.googleReviewId).sort()).toEqual(["kept", "skipped-1"]);
  });

  it("does not reconcile when a fetched id is malformed", async () => {
    const repo = createFakeGoogleReviewsRepository({
      reviews: [
        {
          id: "cached-1",
          googleReviewId: "still-cached",
          reviewerDisplayName: "Someone",
          reviewerPhotoUrl: null,
          starRating: 4,
          reviewText: "fine",
          reviewCreatedAt: "2026-10-20T00:00:00Z",
          reviewUpdatedAt: "2026-10-20T00:00:00Z",
          firstSyncedAt: "2026-10-20T00:00:00Z",
          lastSeenAt: "2026-10-20T00:00:00Z",
        },
      ],
    });
    const client = createFakeGoogleBusinessProfileReviewsClient({
      result: {
        reviews: [makeReview()],
        fetchedReviewIds: ["g-1", ""],
        skippedReviewIds: [],
        averageRating: 5,
        totalReviewCount: 1,
      },
    });

    await expect(syncGoogleReviews(client, repo, now)).rejects.toThrow(/malformed_review_id/);
    expect((await repo.getAllCachedReviews()).map((review) => review.googleReviewId)).toEqual(["still-cached"]);
    expect((await repo.getSyncState()).overallRating).toBeNull();
  });

  it("leaves the previous featured selection in place when the save fails", async () => {
    const repo = createFakeGoogleReviewsRepository({
      reviews: [
        {
          id: "cached-1",
          googleReviewId: "g-1",
          reviewerDisplayName: "Jamie Lee",
          reviewerPhotoUrl: null,
          starRating: 5,
          reviewText: "Great clean!",
          reviewCreatedAt: "2026-10-20T00:00:00Z",
          reviewUpdatedAt: "2026-10-20T00:00:00Z",
          firstSyncedAt: "2026-10-20T00:00:00Z",
          lastSeenAt: "2026-10-20T00:00:00Z",
        },
      ],
    });
    await repo.setFeaturedReviews([{ reviewId: "cached-1", displayOrder: 1 }]);
    repo.failNextSetFeaturedReviews();

    await expect(repo.setFeaturedReviews([])).rejects.toThrow(/featured_reviews_failed/);
    expect(await repo.getFeaturedReviewSelections()).toEqual([{ reviewId: "cached-1", displayOrder: 1 }]);
  });

  it("treats a superseded sync as a distinct outcome, not a failure, and writes nothing from the stale call", async () => {
    const repo = createFakeGoogleReviewsRepository();
    const newerClient = createFakeGoogleBusinessProfileReviewsClient({
      result: { reviews: [makeReview({ googleReviewId: "newer" })], averageRating: 4.5, totalReviewCount: 10 },
    });
    // A sync that "started" after `now` already committed.
    await syncGoogleReviews(newerClient, repo, new Date(now.getTime() + 60_000));

    const staleClient = createFakeGoogleBusinessProfileReviewsClient({
      result: { reviews: [makeReview({ googleReviewId: "stale-write" })], averageRating: 1, totalReviewCount: 1 },
    });
    const result = await syncGoogleReviews(staleClient, repo, now);

    expect(result.outcome).toBe("superseded");
    expect((await repo.getAllCachedReviews()).map((r) => r.googleReviewId)).toEqual(["newer"]);
    expect((await repo.getSyncState()).totalReviewCount).toBe(10);
  });
});
