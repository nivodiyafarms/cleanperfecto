/**
 * Application-side half of the empty-result guard. The database function
 * repeats this rule and is the boundary that actually refuses the write.
 * An empty fetched-id list may reconcile only when the caller explicitly
 * confirms a complete fetch of zero reviews.
 */
export function isConfirmedEmptyReconciliation(input: {
  confirmEmptyReconciliation: boolean;
  fetchedReviewIds: readonly string[];
  reviews: readonly unknown[];
  skippedReviewIds: readonly string[];
  totalReviewCount: number;
}): boolean {
  return (
    input.confirmEmptyReconciliation === true &&
    input.fetchedReviewIds.length === 0 &&
    input.reviews.length === 0 &&
    input.skippedReviewIds.length === 0 &&
    input.totalReviewCount === 0
  );
}
