const SAFE_ERROR = /^[a-z0-9_]+(?::[1-5]\d{2})?$/;
const SAFE_CODE = /^[a-z0-9_]+$/;

/**
 * The only error text this feature may persist, return, or log. The
 * message is a bounded code plus an optional HTTP status — never a
 * response body, header, token, or credential.
 */
export class SanitizedGoogleReviewsError extends Error {
  readonly code: string;
  readonly httpStatus: number | null;

  constructor(code: string, httpStatus: number | null = null) {
    const status = httpStatus !== null && httpStatus >= 100 && httpStatus <= 599 ? httpStatus : null;
    const safeCode = SAFE_CODE.test(code) ? code : "redacted_sync_error";
    super(status === null || safeCode === "redacted_sync_error" ? safeCode : `${safeCode}:${status}`);
    this.name = "SanitizedGoogleReviewsError";
    this.code = safeCode === "redacted_sync_error" ? "redacted_sync_error" : safeCode;
    this.httpStatus = safeCode === "redacted_sync_error" ? null : status;
  }
}

function isTimeoutError(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("name" in error)) return false;
  const name = String(error.name);
  return name === "TimeoutError" || name === "AbortError";
}

/** Collapses any thrown value to a bounded code. Raw messages are never kept. */
export function sanitizeGoogleReviewsError(error: unknown): SanitizedGoogleReviewsError {
  if (error instanceof SanitizedGoogleReviewsError && SAFE_ERROR.test(error.message)) {
    return error;
  }
  if (isTimeoutError(error)) return new SanitizedGoogleReviewsError("timeout");
  return new SanitizedGoogleReviewsError("network_error");
}

/** Last line of defense before a sync error is written to the database. */
export function boundSyncErrorCode(value: string): string {
  if (SAFE_ERROR.test(value) && value.length <= 80) return value;
  return "redacted_sync_error";
}
