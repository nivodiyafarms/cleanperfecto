const POSTGRES_CODE = /^[0-9A-Z]{5}$/;

/** Fixed label for a failed featured-review save. Never a database message. */
export const FEATURED_REVIEWS_WRITE_FAILED = "featured_reviews_write_failed";

/**
 * Thrown when set_featured_google_reviews fails. The database message is
 * discarded so it cannot be logged. Console output may include only a
 * validated SQLSTATE plus FEATURED_REVIEWS_WRITE_FAILED.
 */
export class FeaturedReviewsWriteError extends Error {
  readonly postgresCode: string;

  constructor(code: string | null | undefined, databaseMessage?: string | null) {
    super(FEATURED_REVIEWS_WRITE_FAILED);
    this.name = "FeaturedReviewsWriteError";
    this.postgresCode = code && POSTGRES_CODE.test(code) ? code : "unknown";
    // Accepted so callers can pass the driver message through, then discarded.
    void databaseMessage;
  }
}

/** Fields safe to pass to console.error. The database message is never included. */
export function featuredReviewsLogFields(error: unknown): { code: string; error: typeof FEATURED_REVIEWS_WRITE_FAILED } {
  const code = error instanceof FeaturedReviewsWriteError ? error.postgresCode : "unknown";
  return { code, error: FEATURED_REVIEWS_WRITE_FAILED };
}
