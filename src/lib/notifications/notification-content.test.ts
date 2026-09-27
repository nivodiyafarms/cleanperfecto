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

  describe("final_total_ready", () => {
    it("deep-links to the plain (login-required) portal path when no authenticated link was generated", () => {
      const content = buildNotificationContent({
        notificationType: "final_total_ready",
        customerName: "Jane",
        visitStartAtUtc: null,
        timezone: "America/Chicago",
        serviceVisitId: "visit-123",
      });
      expect(content.text).toContain("/my/payments?visit=visit-123");
    });

    it("uses the one-click authenticated link verbatim instead of the plain portal path when one was generated", () => {
      const authenticatedLink = "https://project.supabase.co/auth/v1/verify?token=abc&type=magiclink&redirect_to=...";
      const content = buildNotificationContent({
        notificationType: "final_total_ready",
        customerName: "Jane",
        visitStartAtUtc: null,
        timezone: "America/Chicago",
        serviceVisitId: "visit-123",
        authenticatedLink,
      });
      expect(content.text).toContain(authenticatedLink);
      expect(content.html).toContain(authenticatedLink);
      expect(content.text).not.toContain("/my/payments?visit=visit-123");
    });

    it("still uses the customer-friendly 'Review Final Total' label with the authenticated link, never developer/auth wording", () => {
      const content = buildNotificationContent({
        notificationType: "final_total_ready",
        customerName: "Jane",
        visitStartAtUtc: null,
        timezone: "America/Chicago",
        serviceVisitId: "visit-123",
        authenticatedLink: "https://project.supabase.co/auth/v1/verify?token=abc",
      });
      expect(content.text).toContain("Review Final Total");
      expect(content.text.toLowerCase()).not.toContain("magic link");
      expect(content.text.toLowerCase()).not.toContain("otp");
    });

    it("uses the approved subject/body copy: 'Cleaning complete — review your Final Total'", () => {
      const content = buildNotificationContent({
        notificationType: "final_total_ready",
        customerName: "Jane",
        visitStartAtUtc: null,
        timezone: "America/Chicago",
        serviceVisitId: "visit-123",
      });
      expect(content.subject).toBe("Cleaning complete — review your Final Total");
      expect(content.text).toContain("Your CleanPerfecto cleaning is complete.");
    });
  });
});
