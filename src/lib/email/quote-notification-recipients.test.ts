import { describe, expect, it } from "vitest";
import { parseQuoteNotificationRecipients } from "@/lib/email/quote-notification-recipients";

describe("parseQuoteNotificationRecipients", () => {
  it("returns an empty list when undefined", () => {
    expect(parseQuoteNotificationRecipients(undefined)).toEqual([]);
  });

  it("returns an empty list for an empty or whitespace-only string", () => {
    expect(parseQuoteNotificationRecipients("")).toEqual([]);
    expect(parseQuoteNotificationRecipients("   ")).toEqual([]);
  });

  it("splits comma-separated addresses and trims whitespace", () => {
    expect(
      parseQuoteNotificationRecipients(" a@example.com , b@example.com ,c@example.com")
    ).toEqual(["a@example.com", "b@example.com", "c@example.com"]);
  });

  it("removes empty entries from stray commas", () => {
    expect(parseQuoteNotificationRecipients("a@example.com,,b@example.com,")).toEqual([
      "a@example.com",
      "b@example.com",
    ]);
  });

  it("drops entries that fail basic email format validation", () => {
    expect(parseQuoteNotificationRecipients("a@example.com,not-an-email,b@example.com")).toEqual([
      "a@example.com",
      "b@example.com",
    ]);
  });

  it("removes case-insensitive duplicates, keeping the first-seen casing", () => {
    expect(
      parseQuoteNotificationRecipients("Admin@Example.com,admin@example.com,ADMIN@EXAMPLE.COM")
    ).toEqual(["Admin@Example.com"]);
  });

  it("parses a four-recipient configuration matching the documented format", () => {
    expect(
      parseQuoteNotificationRecipients(
        "owner1@example.com,support@example.com,owner2@example.com,owner3@example.com"
      )
    ).toEqual([
      "owner1@example.com",
      "support@example.com",
      "owner2@example.com",
      "owner3@example.com",
    ]);
  });
});
