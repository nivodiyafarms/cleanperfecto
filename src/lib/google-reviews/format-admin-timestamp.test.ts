import { describe, expect, it } from "vitest";
import { formatGoogleReviewsAdminTimestamp } from "./format-admin-timestamp";

function normalize(value: string): string {
  return value.replace(/\u202f/g, " ").replace(/\u00a0/g, " ");
}

describe("formatGoogleReviewsAdminTimestamp", () => {
  it("shows a UTC evening instant as America/Chicago wall time", () => {
    // 2026-10-31T23:06:00Z is 6:06 PM CDT, still the same calendar day.
    expect(normalize(formatGoogleReviewsAdminTimestamp("2026-10-31T23:06:00.000Z"))).toBe("Oct 31, 2026, 6:06 PM");
  });

  it("applies Central standard time in winter", () => {
    // 2026-01-15T00:06:00Z is 6:06 PM CST on the previous calendar day.
    expect(normalize(formatGoogleReviewsAdminTimestamp("2026-01-15T00:06:00.000Z"))).toBe("Jan 14, 2026, 6:06 PM");
  });

  it("labels a missing sync as Never", () => {
    expect(formatGoogleReviewsAdminTimestamp(null)).toBe("Never");
  });
});
