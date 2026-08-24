import { timingSafeEqual } from "node:crypto";

/**
 * Pure authorization decision for the notification dispatch cron route —
 * extracted from the route handler so it's directly unit-testable, same
 * "extract the pure decision function" pattern as resolveAdminSession/
 * resolveCustomerSession. Constant-time comparison guards against a timing
 * side-channel; the length check up front is necessary because
 * timingSafeEqual throws (rather than returning false) on mismatched
 * buffer lengths.
 */
export function isCronRequestAuthorized(providedSecret: string | null, expectedSecret: string | undefined): boolean {
  if (!expectedSecret) return false;

  const expectedBuf = Buffer.from(expectedSecret);
  const providedBuf = Buffer.from(providedSecret ?? "");
  if (expectedBuf.length !== providedBuf.length) return false;
  return timingSafeEqual(expectedBuf, providedBuf);
}
