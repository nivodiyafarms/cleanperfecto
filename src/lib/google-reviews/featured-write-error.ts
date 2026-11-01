const POSTGRES_CODE = /^[0-9A-Z]{5}$/;
const UNSAFE_LOG_TEXT = /eyJ|bearer|token|secret|apikey|sb_secret|service_role|password/i;

/**
 * Console-only detail for a failed featured-review save. Not written to
 * sync state and not returned to the browser. The Postgres message is
 * kept only when it is short and contains no credential-shaped text.
 */
export class FeaturedReviewsWriteError extends Error {
  readonly postgresCode: string;
  readonly postgresMessage: string;

  constructor(code: string | null | undefined, message: string | null | undefined) {
    super("setFeaturedReviews failed");
    this.name = "FeaturedReviewsWriteError";
    this.postgresCode = code && POSTGRES_CODE.test(code) ? code : "unknown";
    this.postgresMessage = boundPostgresMessage(message);
  }
}

function boundPostgresMessage(message: string | null | undefined): string {
  if (!message) return "redacted";
  const trimmed = message.replace(/\s+/g, " ").trim();
  if (trimmed.length === 0 || trimmed.length > 200) return "redacted";
  if (UNSAFE_LOG_TEXT.test(trimmed)) return "redacted";
  return trimmed;
}

/** Fields safe to pass to console.error. Anything else collapses to a redacted pair. */
export function featuredReviewsLogFields(error: unknown): { code: string; message: string } {
  if (error instanceof FeaturedReviewsWriteError) {
    return { code: error.postgresCode, message: error.postgresMessage };
  }
  return { code: "unknown", message: "redacted" };
}
