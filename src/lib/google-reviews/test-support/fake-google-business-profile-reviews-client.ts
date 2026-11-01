import type { GoogleBusinessProfileReviewsClient } from "../client";
import type { FetchAllReviewsResult } from "../types";

type FakeFetchResult = Omit<FetchAllReviewsResult, "fetchedReviewIds" | "skippedReviewIds" | "confirmEmptyReconciliation"> &
  Partial<Pick<FetchAllReviewsResult, "fetchedReviewIds" | "skippedReviewIds" | "confirmEmptyReconciliation">>;

/**
 * Test-only fixture client — never imported by any production code path
 * (homepage, admin, or the cron route all construct the real client via
 * createGoogleBusinessProfileReviewsClient). Exists purely so sync.ts's
 * orchestration logic can be unit-tested without a network call.
 */
export function createFakeGoogleBusinessProfileReviewsClient(
  behavior: { result: FakeFetchResult } | { error: Error }
): GoogleBusinessProfileReviewsClient {
  return {
    async fetchAllReviews(): Promise<FetchAllReviewsResult> {
      if ("error" in behavior) throw behavior.error;
      const fetchedReviewIds = behavior.result.fetchedReviewIds ?? behavior.result.reviews.map((review) => review.googleReviewId);
      const skippedReviewIds = behavior.result.skippedReviewIds ?? [];
      const confirmEmptyReconciliation = behavior.result.confirmEmptyReconciliation ?? false;
      return { ...behavior.result, fetchedReviewIds, skippedReviewIds, confirmEmptyReconciliation };
    },
  };
}
