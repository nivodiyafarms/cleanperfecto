import { describe, expect, it } from "vitest";
import { isCronRequestAuthorized } from "./cron-auth";

describe("isCronRequestAuthorized", () => {
  it("rejects when no secret is configured at all", () => {
    expect(isCronRequestAuthorized("anything", undefined)).toBe(false);
  });

  it("rejects a missing header", () => {
    expect(isCronRequestAuthorized(null, "correct-secret")).toBe(false);
  });

  it("rejects a header that doesn't match", () => {
    expect(isCronRequestAuthorized("wrong-secret", "correct-secret")).toBe(false);
  });

  it("rejects a header of a different length safely (no throw)", () => {
    expect(() => isCronRequestAuthorized("short", "a-much-longer-correct-secret")).not.toThrow();
    expect(isCronRequestAuthorized("short", "a-much-longer-correct-secret")).toBe(false);
  });

  it("accepts a header that exactly matches the configured secret", () => {
    expect(isCronRequestAuthorized("correct-secret", "correct-secret")).toBe(true);
  });
});
