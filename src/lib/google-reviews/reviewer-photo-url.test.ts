import { describe, expect, it } from "vitest";
import { REVIEWER_PHOTO_REMOTE_PATTERNS, isAllowedReviewerPhotoUrl } from "./reviewer-photo-url";

describe("isAllowedReviewerPhotoUrl", () => {
  it("allows HTTPS URLs on googleusercontent.com and its subdomains", () => {
    expect(isAllowedReviewerPhotoUrl("https://googleusercontent.com/a")).toBe(true);
    expect(isAllowedReviewerPhotoUrl("https://lh3.googleusercontent.com/a-/photo")).toBe(true);
    expect(isAllowedReviewerPhotoUrl("https://a.b.googleusercontent.com/photo")).toBe(true);
    expect(isAllowedReviewerPhotoUrl("https://lh3.googleusercontent.com:443/photo")).toBe(true);
  });

  it("rejects lookalikes, credentials, unexpected ports, and non-HTTPS URLs", () => {
    expect(isAllowedReviewerPhotoUrl("https://lh3.googleusercontent.com.evil.com/photo")).toBe(false);
    expect(isAllowedReviewerPhotoUrl("https://notgoogleusercontent.com/photo")).toBe(false);
    expect(isAllowedReviewerPhotoUrl("https://evilgoogleusercontent.com/photo")).toBe(false);
    expect(isAllowedReviewerPhotoUrl("https://user:pass@lh3.googleusercontent.com/photo")).toBe(false);
    expect(isAllowedReviewerPhotoUrl("https://lh3.googleusercontent.com:8443/photo")).toBe(false);
    expect(isAllowedReviewerPhotoUrl("http://lh3.googleusercontent.com/photo")).toBe(false);
    expect(isAllowedReviewerPhotoUrl(null)).toBe(false);
    expect(isAllowedReviewerPhotoUrl("")).toBe(false);
  });
});

describe("REVIEWER_PHOTO_REMOTE_PATTERNS", () => {
  it("matches the validator: HTTPS, default port, googleusercontent hosts only", () => {
    expect(REVIEWER_PHOTO_REMOTE_PATTERNS.length).toBeGreaterThan(0);
    for (const pattern of REVIEWER_PHOTO_REMOTE_PATTERNS) {
      if (pattern instanceof URL) {
        throw new Error("reviewer photo patterns must be hostname objects so the port can be pinned");
      }
      expect(pattern.protocol).toBe("https");
      expect(pattern.port).toBe("");
      expect(pattern.hostname === "googleusercontent.com" || pattern.hostname?.endsWith(".googleusercontent.com")).toBe(true);
    }
  });
});
