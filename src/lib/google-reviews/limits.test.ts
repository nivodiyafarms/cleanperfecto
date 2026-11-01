import { describe, expect, it } from "vitest";
import { GOOGLE_REVIEWS_REQUEST_TIMEOUT_MS, GOOGLE_REVIEWS_ROUTE_MAX_DURATION_SECONDS, GOOGLE_REVIEWS_SYNC_DEADLINE_MS, requestTimeoutMs } from "./limits";

describe("Google reviews request budget", () => {
  it("keeps the sync deadline and each request inside the route maxDuration", () => {
    expect(GOOGLE_REVIEWS_SYNC_DEADLINE_MS).toBeLessThan(GOOGLE_REVIEWS_ROUTE_MAX_DURATION_SECONDS * 1000);
    expect(GOOGLE_REVIEWS_REQUEST_TIMEOUT_MS).toBeLessThan(GOOGLE_REVIEWS_SYNC_DEADLINE_MS);
  });

  it("refuses to start a request that cannot finish before the deadline", () => {
    expect(requestTimeoutMs(0, 10_000, 8_000)).toBe(8_000);
    expect(requestTimeoutMs(7_000, 10_000, 8_000)).toBe(3_000);
    expect(requestTimeoutMs(9_800, 10_000, 8_000)).toBeNull();
  });
});
