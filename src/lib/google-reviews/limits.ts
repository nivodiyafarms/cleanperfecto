/**
 * Vercel route budget for the Google reviews sync. 60 seconds stays within
 * both the Hobby Fluid and Pro serverless execution caps this project can
 * be deployed on. The Google call deadline is shorter so the database
 * transaction still has time to commit or roll back before the platform
 * kills the function.
 */
/** Kept in sync with the literal `export const maxDuration = 60` on the sync route. Next.js only accepts a literal there. */
export const GOOGLE_REVIEWS_ROUTE_MAX_DURATION_SECONDS = 60;

/** Per token-exchange or reviews.list request. Never longer than the time left before the sync deadline. */
export const GOOGLE_REVIEWS_REQUEST_TIMEOUT_MS = 8_000;

/** Overall budget for every Google request in one sync, including pagination. No retries are issued outside this window. */
export const GOOGLE_REVIEWS_SYNC_DEADLINE_MS = 45_000;

/** Runaway-page guard. The deadline above stops the loop first whenever finishing another page would exceed the route budget. */
export const GOOGLE_REVIEWS_MAX_PAGES = 40;

const MINIMUM_REQUEST_BUDGET_MS = 500;

/**
 * How long the next Google request may run. Returns null when the remaining
 * deadline cannot fit a request — the caller must fail the sync instead of
 * starting one that would outlive the route.
 */
export function requestTimeoutMs(nowMs: number, deadlineAtMs: number, perRequestTimeoutMs = GOOGLE_REVIEWS_REQUEST_TIMEOUT_MS): number | null {
  const remaining = deadlineAtMs - nowMs;
  if (remaining < MINIMUM_REQUEST_BUDGET_MS) return null;
  return Math.min(perRequestTimeoutMs, remaining);
}
