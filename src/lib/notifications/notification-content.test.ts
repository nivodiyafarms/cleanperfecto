import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildNotificationContent } from "./notification-content";

describe("buildNotificationContent", () => {
  it("links consent_required and consent_reminder to the portal, not an external URL", () => {
    for (const notificationType of ["consent_required", "consent_reminder"] as const) {
      const content = buildNotificationContent({ notificationType, customerName: "Jane", visitStartAtUtc: null, timezone: "America/Chicago" });
      expect(content.text).toContain("/my/consent");
    }
  });

  describe("review_request", () => {
    beforeEach(() => {
      process.env.GOOGLE_REVIEW_URL = "https://example.com/leave-a-review";
    });
    afterEach(() => {
      delete process.env.GOOGLE_REVIEW_URL;
    });

    it("links to the configured Google review URL, not a portal path", () => {
      const content = buildNotificationContent({ notificationType: "review_request", customerName: "Jane", visitStartAtUtc: null, timezone: "America/Chicago" });
      expect(content.text).toContain("https://example.com/leave-a-review");
      expect(content.text).not.toContain("/my/");
    });

    it("throws (never sends a broken/missing link) when GOOGLE_REVIEW_URL is not configured", () => {
      delete process.env.GOOGLE_REVIEW_URL;
      expect(() => buildNotificationContent({ notificationType: "review_request", customerName: "Jane", visitStartAtUtc: null, timezone: "America/Chicago" })).toThrow();
    });
  });
});
