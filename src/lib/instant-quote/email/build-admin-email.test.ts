import { describe, expect, it } from "vitest";
import { buildInstantQuoteAdminEmail } from "./build-admin-email";
import { buildInstantQuoteEmailDetails } from "./build-email-details";
import type { SubmitInstantQuoteResult } from "../submit-instant-quote";
import type { InstantQuoteRawInput } from "../types";

type OkResult = Extract<SubmitInstantQuoteResult, { ok: true }>;

function rawInput(overrides: Partial<InstantQuoteRawInput> = {}): InstantQuoteRawInput {
  return {
    propertyType: "home",
    cleaningType: "deep",
    condition: "heavy",
    rooms: { bedrooms: 3, fullBathrooms: 2, halfBathrooms: 1 },
    squareFeet: 2000,
    frequency: "one_time",
    isPrepaidPackage: false,
    visitCount: 1,
    addOnIds: [],
    name: "Jane Customer",
    phone: "469-555-0100",
    email: "jane@example.com",
    serviceAddress: { line1: "123 Main St", line2: "Apt 4B", city: "Frisco", state: "TX", zip: "75056" },
    preferredDate: "2026-09-01",
    leadSource: "google",
    leadSourceDetail: "search ad",
    ...overrides,
  };
}

function okResult(overrides: Partial<OkResult> = {}): OkResult {
  return {
    ok: true,
    quoteId: "11111111-1111-1111-1111-111111111111",
    customerId: "customer-1",
    identityConflict: false,
    estimateType: "instant_range",
    calculatedTotal: 226.5,
    range: { lower: 230, upper: 250 },
    hasStartingAtPricing: false,
    prepaidPackageTotal: null,
    effectivePricePerVisit: null,
    firstCleaningOfferApplied: true,
    regularRange: null,
    manualReviewRequired: false,
    manualReviewReasons: [],
    movePackageLevel: null,
    moveCompleteUpgradeConfigured: null,
    ...overrides,
  };
}

describe("buildInstantQuoteAdminEmail", () => {
  it("contains the quote ID", () => {
    const { text, html } = buildInstantQuoteAdminEmail(buildInstantQuoteEmailDetails(rawInput(), okResult()));
    expect(text).toContain("11111111-1111-1111-1111-111111111111");
    expect(html).toContain("11111111-1111-1111-1111-111111111111");
  });

  it("contains submitted contact info", () => {
    const { text } = buildInstantQuoteAdminEmail(buildInstantQuoteEmailDetails(rawInput(), okResult()));
    expect(text).toContain("Jane Customer");
    expect(text).toContain("469-555-0100");
    expect(text).toContain("jane@example.com");
  });

  it("contains service/property details", () => {
    const { text } = buildInstantQuoteAdminEmail(buildInstantQuoteEmailDetails(rawInput(), okResult()));
    expect(text).toContain("123 Main St");
    expect(text).toContain("Apt 4B");
    expect(text).toContain("Frisco");
    expect(text).toContain("75056");
    expect(text).toContain("Home");
    expect(text).toContain("Deep Cleaning");
    expect(text).toContain("Bedrooms: 3");
    expect(text).toContain("Full bathrooms: 2");
    expect(text).toContain("Half bathrooms: 1");
    expect(text).toContain("Square footage: 2000");
    expect(text).toContain("Heavy");
    expect(text).toContain("2026-09-01");
    expect(text).toContain("google");
    expect(text).toContain("search ad");
  });

  it("contains the authoritative estimate", () => {
    const { text } = buildInstantQuoteAdminEmail(buildInstantQuoteEmailDetails(rawInput(), okResult()));
    expect(text).toContain("$230 - $250");
    expect(text).toContain("$226.50");
    expect(text).toContain("First-cleaning offer applied: Yes");
  });

  it("includes manual reason codes for admin use", () => {
    const details = buildInstantQuoteEmailDetails(
      rawInput({ serviceAddress: { line1: "1 Far Rd", zip: "75054" } }),
      okResult({
        estimateType: "manual_review",
        range: null,
        manualReviewRequired: true,
        manualReviewReasons: ["ZIP_MANUAL_REVIEW_REQUIRED"],
      })
    );
    const { text } = buildInstantQuoteAdminEmail(details);
    expect(text).toContain("ZIP_MANUAL_REVIEW_REQUIRED");
    expect(text).toContain("Manual review required");
  });

  it("includes visit-specific package add-on assignments", () => {
    const details = buildInstantQuoteEmailDetails(
      rawInput({
        isPrepaidPackage: true,
        visitCount: 3,
        visitAddOns: [["inside_oven"], [], ["inside_refrigerator", "inside_oven"]],
      }),
      okResult({ prepaidPackageTotal: 500, effectivePricePerVisit: 166.67 })
    );
    const { text } = buildInstantQuoteAdminEmail(details);
    expect(text).toContain("Visit 1: Oven Interior");
    expect(text).toContain("Visit 2: None");
    expect(text).toContain("Visit 3: Refrigerator Interior, Oven Interior");
    expect(text).toContain("Prepaid package total: $500.00");
    expect(text).toContain("Effective price/visit: $166.67");
  });

  it("includes one-time add-on selections when not a package", () => {
    const details = buildInstantQuoteEmailDetails(
      rawInput({ addOnIds: ["inside_oven", "inside_refrigerator"] }),
      okResult()
    );
    const { text } = buildInstantQuoteAdminEmail(details);
    expect(text).toContain("Oven Interior, Refrigerator Interior");
  });

  it("states an identity conflict plainly without exposing unrelated customer PII", () => {
    const details = buildInstantQuoteEmailDetails(
      rawInput(),
      okResult({
        customerId: null,
        identityConflict: true,
        estimateType: "manual_review",
        range: null,
        manualReviewRequired: true,
        manualReviewReasons: ["CUSTOMER_IDENTITY_CONFLICT"],
      })
    );
    const { text, html } = buildInstantQuoteAdminEmail(details);
    expect(text).toContain("Identity conflict detected — customer association requires admin review.");
    expect(html).toContain("Identity conflict detected");
    // No other customer's UUID, name, email, or phone appears — only this submission's own contact info.
    expect(text).not.toMatch(/customer-[a-zA-Z0-9-]+/);
  });

  it("escapes customer-provided content in the HTML body", () => {
    const details = buildInstantQuoteEmailDetails(
      rawInput({ name: "<script>alert(1)</script>", message: "Please clean the \"kitchen\"" }),
      okResult()
    );
    const { html } = buildInstantQuoteAdminEmail(details);
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&quot;kitchen&quot;");
  });

  describe("hostile input", () => {
    it("escapes a <script> tag in the customer name everywhere it appears", () => {
      const details = buildInstantQuoteEmailDetails(
        rawInput({ name: '<script>alert("x")</script>' }),
        okResult()
      );
      const { html } = buildInstantQuoteAdminEmail(details);
      expect(html).not.toContain('<script>alert("x")</script>');
      expect(html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
    });

    it("escapes an inline tag embedded in the service address", () => {
      const details = buildInstantQuoteEmailDetails(
        rawInput({ serviceAddress: { line1: "123 <b>Main</b> St", zip: "75056" } }),
        okResult()
      );
      const { html } = buildInstantQuoteAdminEmail(details);
      expect(html).not.toContain("<b>Main</b>");
      expect(html).toContain("123 &lt;b&gt;Main&lt;/b&gt; St");
    });

    it("escapes ampersand and quotes in lead_source_detail", () => {
      const details = buildInstantQuoteEmailDetails(
        rawInput({ leadSource: "referral", leadSourceDetail: 'Tom & Jerry "Referral"' }),
        okResult()
      );
      const { html } = buildInstantQuoteAdminEmail(details);
      expect(html).toContain("Tom &amp; Jerry &quot;Referral&quot;");
      expect(html).not.toContain('Tom & Jerry "Referral"');
    });

    it("escapes a raw <script> tag in the free-text message", () => {
      const details = buildInstantQuoteEmailDetails(
        rawInput({ message: "<img src=x onerror=alert(1)>" }),
        okResult()
      );
      const { html } = buildInstantQuoteAdminEmail(details);
      expect(html).not.toContain("<img src=x onerror=alert(1)>");
      expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    });

    it("plain-text body is never HTML-escaped — raw customer text stays readable", () => {
      const details = buildInstantQuoteEmailDetails(
        rawInput({ name: "O'Brien & Sons", leadSource: "referral", leadSourceDetail: 'Tom & Jerry "Referral"' }),
        okResult()
      );
      const { text } = buildInstantQuoteAdminEmail(details);
      expect(text).toContain("O'Brien & Sons");
      expect(text).toContain('Tom & Jerry "Referral"');
      expect(text).not.toContain("&amp;");
      expect(text).not.toContain("&quot;");
    });

    it("strips embedded CR/LF from the customer name before it reaches the subject line (header-injection guard)", () => {
      const details = buildInstantQuoteEmailDetails(
        rawInput({ name: "Jane\r\nBcc: attacker@evil.example" }),
        okResult()
      );
      const { subject } = buildInstantQuoteAdminEmail(details);
      // The security property is "no raw CR/LF" (so "Bcc:" can never start
      // a new header line) — not the absence of the substring "Bcc:" itself,
      // which is harmless once it's inert text within a single header line.
      expect(subject).not.toMatch(/[\r\n]/);
      expect(subject).toBe("New Instant Quote — Jane Bcc: attacker@evil.example — Instant Estimate");
    });

    it("a bare LF in the name also cannot reach the subject as a raw newline", () => {
      const details = buildInstantQuoteEmailDetails(
        rawInput({ name: "Jane\nX-Injected: true" }),
        okResult()
      );
      const { subject } = buildInstantQuoteAdminEmail(details);
      expect(subject.split("\n")).toHaveLength(1);
    });
  });

  it("subject includes customer name and Instant Estimate/Manual Review label", () => {
    const automatic = buildInstantQuoteAdminEmail(buildInstantQuoteEmailDetails(rawInput(), okResult()));
    expect(automatic.subject).toBe("New Instant Quote — Jane Customer — Instant Estimate");

    const manual = buildInstantQuoteAdminEmail(
      buildInstantQuoteEmailDetails(
        rawInput(),
        okResult({ estimateType: "manual_review", range: null, manualReviewRequired: true })
      )
    );
    expect(manual.subject).toBe("New Instant Quote — Jane Customer — Manual Review");
  });

  it("shows 'Not provided' for absent phone/email/square footage/preferred date", () => {
    const details = buildInstantQuoteEmailDetails(
      rawInput({ phone: undefined, squareFeet: undefined, preferredDate: undefined }),
      okResult()
    );
    const { text } = buildInstantQuoteAdminEmail(details);
    expect(text).toContain("Phone: Not provided");
    expect(text).toContain("Square footage: Not provided");
    expect(text).toContain("Preferred date: Not provided");
  });
});
