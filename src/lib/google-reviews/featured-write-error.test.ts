import { describe, expect, it } from "vitest";
import { FEATURED_REVIEWS_WRITE_FAILED, FeaturedReviewsWriteError, featuredReviewsLogFields } from "./featured-write-error";

describe("featuredReviewsLogFields", () => {
  it("logs a validated SQLSTATE and a fixed label, never the database message", () => {
    const databaseMessage = "DELETE requires a WHERE clause";
    const error = new FeaturedReviewsWriteError("21000", databaseMessage);
    const fields = featuredReviewsLogFields(error);

    expect(fields).toEqual({ code: "21000", error: FEATURED_REVIEWS_WRITE_FAILED });
    expect(JSON.stringify(fields)).not.toContain(databaseMessage);
    expect(error.message).toBe(FEATURED_REVIEWS_WRITE_FAILED);
    expect(JSON.stringify(error)).not.toContain(databaseMessage);
  });

  it("drops an invalid SQLSTATE and still omits the database message", () => {
    const databaseMessage = "failed token=should-not-leak";
    const error = new FeaturedReviewsWriteError("not-a-code", databaseMessage);
    const fields = featuredReviewsLogFields(error);

    expect(fields).toEqual({ code: "unknown", error: FEATURED_REVIEWS_WRITE_FAILED });
    expect(JSON.stringify(fields)).not.toContain("token");
    expect(JSON.stringify(error)).not.toContain("token");
  });

  it("uses the same fixed label for errors that are not a featured-write failure", () => {
    const fields = featuredReviewsLogFields(new Error("database down, token=should-not-leak"));
    expect(fields).toEqual({ code: "unknown", error: FEATURED_REVIEWS_WRITE_FAILED });
    expect(JSON.stringify(fields)).not.toContain("token");
  });
});
