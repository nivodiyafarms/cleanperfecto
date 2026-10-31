import { describe, expect, it, vi } from "vitest";
import { createGoogleBusinessProfileReviewsClient } from "./client";
import { SanitizedGoogleReviewsError } from "./errors";
import type { GoogleBusinessProfileConfig } from "./config";

const config: GoogleBusinessProfileConfig = {
  clientId: "client-id",
  clientSecret: "client-secret",
  refreshToken: "refresh-token",
  accountId: "123",
  locationId: "456",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function tokenResponse(): Response {
  return jsonResponse({ access_token: "access-token-value" });
}

describe("createGoogleBusinessProfileReviewsClient", () => {
  it("builds the reviews URL with each resource prefix exactly once", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("https://oauth2.googleapis.com/token")) return tokenResponse();
      return jsonResponse({ reviews: [], averageRating: 0, totalReviewCount: 0 });
    });

    await createGoogleBusinessProfileReviewsClient(config, { fetchImpl }).fetchAllReviews();

    const reviewsCall = fetchImpl.mock.calls.map((call) => String(call[0])).find((url) => url.includes("/reviews"));
    expect(reviewsCall).toContain("https://mybusiness.googleapis.com/v4/accounts/123/locations/456/reviews");
    expect(reviewsCall).not.toContain("accounts/accounts/");
    expect(reviewsCall).not.toContain("locations/locations/");
  });

  it("rejects a doubled resource prefix before any network call", async () => {
    const fetchImpl = vi.fn();
    await expect(
      createGoogleBusinessProfileReviewsClient({ ...config, accountId: "accounts/123" }, { fetchImpl }).fetchAllReviews()
    ).rejects.toMatchObject({ message: "invalid_resource_id" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("does not keep an OAuth error body", async () => {
    const fetchImpl = vi.fn(async () => new Response('{"error":"invalid_grant","refresh_token":"super-secret-value"}', { status: 400 }));

    await expect(createGoogleBusinessProfileReviewsClient(config, { fetchImpl }).fetchAllReviews()).rejects.toEqual(
      expect.objectContaining({ message: "oauth_refresh_failed:400" })
    );
    try {
      await createGoogleBusinessProfileReviewsClient(config, { fetchImpl }).fetchAllReviews();
    } catch (error) {
      expect(error).toBeInstanceOf(SanitizedGoogleReviewsError);
      expect(String(error)).not.toContain("super-secret-value");
      expect((error as Error).message).not.toContain("refresh_token");
    }
  });

  it("does not keep a reviews.list error body", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes("oauth")) return tokenResponse();
      return new Response("access_token=super-secret-value", { status: 503 });
    });

    await expect(createGoogleBusinessProfileReviewsClient(config, { fetchImpl }).fetchAllReviews()).rejects.toMatchObject({
      message: "reviews_list_failed:503",
    });
  });

  it("turns a timeout whose message contains a URL into a timeout code", async () => {
    const fetchImpl = vi.fn(async () => {
      const error = new Error("The operation was aborted: https://oauth2.googleapis.com/token secret");
      error.name = "TimeoutError";
      throw error;
    });

    await expect(createGoogleBusinessProfileReviewsClient(config, { fetchImpl }).fetchAllReviews()).rejects.toMatchObject({
      message: "timeout",
    });
  });

  it("skips an unspecified star rating and still returns its id separately from valid reviews", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes("oauth")) return tokenResponse();
      return jsonResponse({
        reviews: [
          {
            reviewId: "valid-1",
            reviewer: { displayName: "Jamie", profilePhotoUrl: "https://lh3.googleusercontent.com/a/photo" },
            starRating: "FIVE",
            comment: "Great",
            createTime: "2026-10-01T00:00:00Z",
            updateTime: "2026-10-01T00:00:00Z",
          },
          {
            reviewId: "skipped-1",
            reviewer: { displayName: "Pat" },
            starRating: "STAR_RATING_UNSPECIFIED",
            comment: "Should not be cached as validated",
            createTime: "2026-10-02T00:00:00Z",
            updateTime: "2026-10-02T00:00:00Z",
          },
        ],
        averageRating: 5,
        totalReviewCount: 2,
      });
    });

    const result = await createGoogleBusinessProfileReviewsClient(config, { fetchImpl }).fetchAllReviews();

    expect(result.reviews.map((review) => review.googleReviewId)).toEqual(["valid-1"]);
    expect(result.fetchedReviewIds).toEqual(["valid-1", "skipped-1"]);
    expect(result.skippedReviewIds).toEqual(["skipped-1"]);
    expect(result.reviews[0]?.reviewerPhotoUrl).toBe("https://lh3.googleusercontent.com/a/photo");
  });

  it("drops a reviewer photo that is not an allowed HTTPS googleusercontent URL", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes("oauth")) return tokenResponse();
      return jsonResponse({
        reviews: [
          {
            reviewId: "valid-1",
            reviewer: { displayName: "Jamie", profilePhotoUrl: "https://user:pass@lh3.googleusercontent.com/a" },
            starRating: "FOUR",
            comment: "Nice",
            createTime: "2026-10-01T00:00:00Z",
            updateTime: "2026-10-01T00:00:00Z",
          },
        ],
        averageRating: 4,
        totalReviewCount: 1,
      });
    });

    const result = await createGoogleBusinessProfileReviewsClient(config, { fetchImpl }).fetchAllReviews();
    expect(result.reviews[0]?.reviewerPhotoUrl).toBeNull();
    expect(result.reviews[0]?.reviewText).toBe("Nice");
  });

  it("fails the fetch when a review id is missing, instead of returning a partial id list", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes("oauth")) return tokenResponse();
      return jsonResponse({
        reviews: [
          { reviewId: "valid-1", starRating: "FIVE", createTime: "2026-10-01T00:00:00Z", updateTime: "2026-10-01T00:00:00Z" },
          { starRating: "FIVE", createTime: "2026-10-01T00:00:00Z", updateTime: "2026-10-01T00:00:00Z" },
        ],
        averageRating: 5,
        totalReviewCount: 2,
      });
    });

    await expect(createGoogleBusinessProfileReviewsClient(config, { fetchImpl }).fetchAllReviews()).rejects.toMatchObject({
      message: "malformed_review_id",
    });
  });

  it("fails the whole fetch when a later page fails, so the caller cannot reconcile a partial list", async () => {
    let page = 0;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes("oauth")) return tokenResponse();
      page += 1;
      if (page === 1) {
        return jsonResponse({
          reviews: [{ reviewId: "page-1", starRating: "FIVE", createTime: "2026-10-01T00:00:00Z", updateTime: "2026-10-01T00:00:00Z" }],
          nextPageToken: "next",
          averageRating: 5,
          totalReviewCount: 2,
        });
      }
      return new Response("secret-page-body", { status: 500 });
    });

    await expect(createGoogleBusinessProfileReviewsClient(config, { fetchImpl }).fetchAllReviews()).rejects.toMatchObject({
      message: "reviews_list_failed:500",
    });
  });

  it("stops before a page that would exceed the sync deadline", async () => {
    let current = 0;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      current += 1_000;
      if (String(input).includes("oauth")) return tokenResponse();
      return jsonResponse({
        reviews: [{ reviewId: "page-1", starRating: "FIVE", createTime: "2026-10-01T00:00:00Z", updateTime: "2026-10-01T00:00:00Z" }],
        nextPageToken: "next",
        averageRating: 5,
        totalReviewCount: 2,
      });
    });

    await expect(
      createGoogleBusinessProfileReviewsClient(config, {
        fetchImpl,
        now: () => current,
        overallDeadlineMs: 1_500,
        perRequestTimeoutMs: 8_000,
      }).fetchAllReviews()
    ).rejects.toMatchObject({ message: "sync_deadline_exceeded" });

    const reviewCalls = fetchImpl.mock.calls.filter((call) => String(call[0]).includes("/reviews"));
    expect(reviewCalls).toHaveLength(1);
  });
});
