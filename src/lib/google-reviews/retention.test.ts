import { describe, expect, it } from "vitest";
import { isReviewEligibleForFeaturing, selectExpiredReviewIds } from "./retention";

describe("selectExpiredReviewIds", () => {
  const now = new Date("2026-10-24T00:00:00Z");

  it("keeps reviews seen within the retention window", () => {
    const reviews = [{ id: "a", lastSeenAt: new Date("2026-10-10T00:00:00Z").toISOString() }];
    expect(selectExpiredReviewIds(reviews, now, 30)).toEqual([]);
  });

  it("expires reviews last seen before the retention window", () => {
    const reviews = [{ id: "a", lastSeenAt: new Date("2026-09-01T00:00:00Z").toISOString() }];
    expect(selectExpiredReviewIds(reviews, now, 30)).toEqual(["a"]);
  });

  it("is exclusive at the exact boundary (not yet expired)", () => {
    const cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const reviews = [{ id: "a", lastSeenAt: cutoff.toISOString() }];
    expect(selectExpiredReviewIds(reviews, now, 30)).toEqual([]);
  });

  it("only returns the ids that are actually expired, from a mixed set", () => {
    const reviews = [
      { id: "fresh", lastSeenAt: new Date("2026-10-23T00:00:00Z").toISOString() },
      { id: "stale", lastSeenAt: new Date("2026-01-01T00:00:00Z").toISOString() },
    ];
    expect(selectExpiredReviewIds(reviews, now, 30)).toEqual(["stale"]);
  });
});

describe("isReviewEligibleForFeaturing", () => {
  const now = new Date("2026-10-24T00:00:00Z");

  it("requires the latest successful sync to have validated the review", () => {
    expect(isReviewEligibleForFeaturing({ lastSeenAt: "2026-10-24T00:00:00Z" }, "2026-10-24T00:00:00Z", now, 30)).toBe(true);
    expect(isReviewEligibleForFeaturing({ lastSeenAt: "2026-10-01T00:00:00Z" }, "2026-10-24T00:00:00Z", now, 30)).toBe(false);
    expect(isReviewEligibleForFeaturing({ lastSeenAt: "2026-10-24T00:00:00Z" }, null, now, 30)).toBe(false);
  });
});
