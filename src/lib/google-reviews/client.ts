import "server-only";

import { googleBusinessProfileReviewsUrl, type GoogleBusinessProfileConfig } from "./config";
import { SanitizedGoogleReviewsError, sanitizeGoogleReviewsError } from "./errors";
import { GOOGLE_REVIEWS_MAX_PAGES, GOOGLE_REVIEWS_REQUEST_TIMEOUT_MS, GOOGLE_REVIEWS_SYNC_DEADLINE_MS, requestTimeoutMs } from "./limits";
import { normalizeGoogleReviewId } from "./review-id";
import { isAllowedReviewerPhotoUrl } from "./reviewer-photo-url";
import type { FetchAllReviewsResult, GoogleStarRating, RawGoogleReview } from "./types";

export interface GoogleBusinessProfileReviewsClient {
  /**
   * Fetches every review page for the configured location and returns them
   * all together, or throws. There is no partial-result return value on
   * purpose — sync.ts reconciles deletions only after this resolves.
   * fetchedReviewIds includes reviews that were skipped for an unknown
   * star rating; reviews contains only the rows safe to display.
   */
  fetchAllReviews(): Promise<FetchAllReviewsResult>;
}

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVIEWS_PAGE_SIZE = 50;

const STAR_RATING_MAP: Record<string, GoogleStarRating> = {
  ONE: 1,
  TWO: 2,
  THREE: 3,
  FOUR: 4,
  FIVE: 5,
};

interface GoogleReviewerPayload {
  displayName?: unknown;
  profilePhotoUrl?: unknown;
  isAnonymous?: unknown;
}

interface GoogleReviewPayload {
  reviewId?: unknown;
  reviewer?: GoogleReviewerPayload;
  starRating?: unknown;
  comment?: unknown;
  createTime?: unknown;
  updateTime?: unknown;
}

interface ListReviewsResponsePayload {
  reviews?: GoogleReviewPayload[];
  averageRating?: unknown;
  totalReviewCount?: unknown;
  nextPageToken?: unknown;
}

export interface GoogleReviewsClientOptions {
  fetchImpl?: typeof fetch;
  now?: () => number;
  perRequestTimeoutMs?: number;
  overallDeadlineMs?: number;
}

async function fetchBounded(
  fetchImpl: typeof fetch,
  url: string | URL,
  init: RequestInit,
  now: () => number,
  deadlineAtMs: number,
  perRequestTimeoutMs: number,
  failureCode: "oauth_refresh_failed" | "reviews_list_failed"
): Promise<Response> {
  const timeoutMs = requestTimeoutMs(now(), deadlineAtMs, perRequestTimeoutMs);
  if (timeoutMs === null) {
    throw new SanitizedGoogleReviewsError("sync_deadline_exceeded");
  }

  let response: Response;
  try {
    response = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    throw sanitizeGoogleReviewsError(error);
  }

  if (!response.ok) {
    // Do not read the body. Google error payloads can echo tokens and request details.
    throw new SanitizedGoogleReviewsError(failureCode, response.status);
  }
  return response;
}

async function readJson(response: Response, invalidCode: "oauth_refresh_invalid" | "reviews_list_invalid"): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new SanitizedGoogleReviewsError(invalidCode, response.status);
  }
}

async function fetchAccessToken(
  config: GoogleBusinessProfileConfig,
  fetchImpl: typeof fetch,
  now: () => number,
  deadlineAtMs: number,
  perRequestTimeoutMs: number
): Promise<string> {
  const response = await fetchBounded(
    fetchImpl,
    TOKEN_URL,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: config.clientId,
        client_secret: config.clientSecret,
        refresh_token: config.refreshToken,
      }),
    },
    now,
    deadlineAtMs,
    perRequestTimeoutMs,
    "oauth_refresh_failed"
  );

  const data = (await readJson(response, "oauth_refresh_invalid")) as { access_token?: unknown };
  if (typeof data.access_token !== "string" || !data.access_token) {
    throw new SanitizedGoogleReviewsError("oauth_refresh_invalid");
  }
  return data.access_token;
}

function readFiniteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/**
 * Classifies one Google review. An unknown star rating is skipped. A
 * missing or malformed id fails the whole fetch — returning a partial id
 * list would let reconciliation treat the rest as deletions.
 */
export function classifyGoogleReview(payload: GoogleReviewPayload): { kind: "valid"; review: RawGoogleReview } | { kind: "skipped"; reviewId: string } {
  const reviewId = normalizeGoogleReviewId(payload.reviewId);
  if (!reviewId) {
    throw new SanitizedGoogleReviewsError("malformed_review_id");
  }

  const starRating = typeof payload.starRating === "string" ? STAR_RATING_MAP[payload.starRating] : undefined;
  if (!starRating) {
    return { kind: "skipped", reviewId };
  }

  if (typeof payload.createTime !== "string" || !payload.createTime.trim() || typeof payload.updateTime !== "string" || !payload.updateTime.trim()) {
    throw new SanitizedGoogleReviewsError("malformed_review");
  }

  const isAnonymous = payload.reviewer?.isAnonymous === true;
  const displayName = typeof payload.reviewer?.displayName === "string" ? payload.reviewer.displayName.trim() : "";
  const photoCandidate = typeof payload.reviewer?.profilePhotoUrl === "string" ? payload.reviewer.profilePhotoUrl : null;
  const comment = typeof payload.comment === "string" && payload.comment.trim() ? payload.comment : null;

  return {
    kind: "valid",
    review: {
      googleReviewId: reviewId,
      reviewerDisplayName: !isAnonymous && displayName ? displayName : "A Google user",
      reviewerPhotoUrl: !isAnonymous && isAllowedReviewerPhotoUrl(photoCandidate) ? photoCandidate : null,
      starRating,
      reviewText: comment,
      createTime: payload.createTime,
      updateTime: payload.updateTime,
    },
  };
}

/**
 * Real client against the Business Profile API v4
 * (mybusiness.googleapis.com/v4/accounts/{accountId}/locations/{locationId}/reviews).
 * Walks every page before returning. averageRating and totalReviewCount
 * come from the last page, which carries the location aggregate.
 * Each request has its own timeout, and the whole walk shares one deadline.
 * There are no retries: a retry would have to fit in the same deadline, and
 * a failed page already means the fetch is incomplete.
 */
export function createGoogleBusinessProfileReviewsClient(
  config: GoogleBusinessProfileConfig,
  options: GoogleReviewsClientOptions = {}
): GoogleBusinessProfileReviewsClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  const perRequestTimeoutMs = options.perRequestTimeoutMs ?? GOOGLE_REVIEWS_REQUEST_TIMEOUT_MS;
  const overallDeadlineMs = options.overallDeadlineMs ?? GOOGLE_REVIEWS_SYNC_DEADLINE_MS;

  return {
    async fetchAllReviews(): Promise<FetchAllReviewsResult> {
      const reviewsUrl = googleBusinessProfileReviewsUrl(config.accountId, config.locationId);
      if (!reviewsUrl) {
        throw new SanitizedGoogleReviewsError("invalid_resource_id");
      }

      const deadlineAtMs = now() + overallDeadlineMs;
      const accessToken = await fetchAccessToken(config, fetchImpl, now, deadlineAtMs, perRequestTimeoutMs);

      const reviews: RawGoogleReview[] = [];
      const fetchedReviewIds: string[] = [];
      const skippedReviewIds: string[] = [];
      let averageRating = 0;
      let totalReviewCount = 0;
      let pageToken: string | undefined;
      let pageCount = 0;

      do {
        if (pageCount >= GOOGLE_REVIEWS_MAX_PAGES) {
          throw new SanitizedGoogleReviewsError("reviews_page_limit_exceeded");
        }

        const url = new URL(reviewsUrl);
        url.searchParams.set("pageSize", String(REVIEWS_PAGE_SIZE));
        if (pageToken) url.searchParams.set("pageToken", pageToken);

        const response = await fetchBounded(
          fetchImpl,
          url,
          { headers: { Authorization: `Bearer ${accessToken}` } },
          now,
          deadlineAtMs,
          perRequestTimeoutMs,
          "reviews_list_failed"
        );
        const payload = (await readJson(response, "reviews_list_invalid")) as ListReviewsResponsePayload;

        for (const review of payload.reviews ?? []) {
          const classified = classifyGoogleReview(review);
          fetchedReviewIds.push(classified.kind === "valid" ? classified.review.googleReviewId : classified.reviewId);
          if (classified.kind === "skipped") {
            skippedReviewIds.push(classified.reviewId);
          } else {
            reviews.push(classified.review);
          }
        }

        averageRating = readFiniteNumber(payload.averageRating, averageRating);
        totalReviewCount = readFiniteNumber(payload.totalReviewCount, totalReviewCount);
        pageToken = typeof payload.nextPageToken === "string" && payload.nextPageToken ? payload.nextPageToken : undefined;
        pageCount += 1;
      } while (pageToken);

      return { reviews, fetchedReviewIds, skippedReviewIds, averageRating, totalReviewCount };
    },
  };
}
