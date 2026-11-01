import { describe, expect, it } from "vitest";
import { FeaturedReviewsWriteError, featuredReviewsLogFields } from "./featured-write-error";

describe("featuredReviewsLogFields", () => {
  it("keeps a short Postgres code and message", () => {
    const error = new FeaturedReviewsWriteError("21000", "DELETE requires a WHERE clause");
    expect(featuredReviewsLogFields(error)).toEqual({
      code: "21000",
      message: "DELETE requires a WHERE clause",
    });
  });

  it("drops a message that contains a token", () => {
    const error = new FeaturedReviewsWriteError("21000", "failed token=should-not-leak");
    expect(featuredReviewsLogFields(error)).toEqual({ code: "21000", message: "redacted" });
  });

  it("redacts errors that are not a featured-write failure", () => {
    expect(featuredReviewsLogFields(new Error("database down, token=should-not-leak"))).toEqual({
      code: "unknown",
      message: "redacted",
    });
  });
});
