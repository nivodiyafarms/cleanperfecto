import { describe, expect, it } from "vitest";
import { buildInstantQuoteCustomerEmail } from "./build-customer-email";
import { buildInstantQuoteEmailDetails } from "./build-email-details";
import type { SubmitInstantQuoteResult } from "../submit-instant-quote";
import type { InstantQuoteRawInput } from "../types";

type OkResult = Extract<SubmitInstantQuoteResult, { ok: true }>;

function rawInput(overrides: Partial<InstantQuoteRawInput> = {}): InstantQuoteRawInput {
  return {
    propertyType: "home",
    cleaningType: "standard",
    condition: "light",
    rooms: { bedrooms: 1, fullBathrooms: 1, halfBathrooms: 0 },
    frequency: "one_time",
    isPrepaidPackage: false,
    visitCount: 1,
    addOnIds: [],
    name: "Jane Customer",
    phone: "469-555-0100",
    email: "jane@example.com",
    serviceAddress: { line1: "123 Main St", city: "Frisco", state: "TX", zip: "75056" },
    ...overrides,
  };
}

function okResult(overrides: Partial<OkResult> = {}): OkResult {
  return {
    ok: true,
    quoteId: "22222222-2222-2222-2222-222222222222",
    customerId: "customer-1",
    identityConflict: false,
    estimateType: "instant_range",
    calculatedTotal: 105.3,
    range: { lower: 110, upper: 130 },
    hasStartingAtPricing: false,
    prepaidPackageTotal: null,
    effectivePricePerVisit: null,
    firstCleaningOfferApplied: true,
    regularRange: null,
    manualReviewRequired: false,
    manualReviewReasons: [],
    ...overrides,
  };
}

describe("buildInstantQuoteCustomerEmail — automatic estimate", () => {
  it("displays the range", () => {
    const { text } = buildInstantQuoteCustomerEmail(buildInstantQuoteEmailDetails(rawInput(), okResult()));
    expect(text).toContain("$110 – $130");
  });

  it("includes a customer-friendly service summary", () => {
    const { text } = buildInstantQuoteCustomerEmail(
      buildInstantQuoteEmailDetails(
        rawInput({ rooms: { bedrooms: 3, fullBathrooms: 2, halfBathrooms: 1 }, squareFeet: 1800 }),
        okResult()
      )
    );
    expect(text).toContain("Property: Home");
    expect(text).toContain("Cleaning: Standard Cleaning");
    expect(text).toContain("3 bedrooms, 2 full bathrooms, 1 half bathroom, approx. 1800 sq. ft.");
    expect(text).toContain("Frequency: One-time");
  });

  it("includes first-cleaning offer wording without a specific percentage, when applied", () => {
    const { text } = buildInstantQuoteCustomerEmail(
      buildInstantQuoteEmailDetails(rawInput(), okResult({ firstCleaningOfferApplied: true }))
    );
    expect(text).toContain("Your eligible first-cleaning special has been included in this estimate.");
    expect(text).not.toMatch(/\d+%/);
  });

  it("omits the first-cleaning offer line when not applied", () => {
    const { text } = buildInstantQuoteCustomerEmail(
      buildInstantQuoteEmailDetails(rawInput(), okResult({ firstCleaningOfferApplied: false }))
    );
    expect(text).not.toContain("first-cleaning special");
  });

  it("never shows internal multipliers, travel percentage, or reason codes", () => {
    const { text, html } = buildInstantQuoteCustomerEmail(buildInstantQuoteEmailDetails(rawInput(), okResult()));
    const lowered = text.toLowerCase();
    expect(lowered).not.toContain("multiplier");
    expect(lowered).not.toContain("travel");
    expect(lowered).not.toContain("supabase");
    expect(text).not.toContain("ZIP_TRAVEL_NOT_CONFIGURED");
    expect(html).not.toContain("ZIP_TRAVEL_NOT_CONFIGURED");
  });

  it("includes the preferred date when supplied", () => {
    const { text } = buildInstantQuoteCustomerEmail(
      buildInstantQuoteEmailDetails(rawInput({ preferredDate: "2026-09-01" }), okResult())
    );
    expect(text).toContain("Preferred date: 2026-09-01");
  });

  it("escapes customer-provided content in the HTML body", () => {
    const { html } = buildInstantQuoteCustomerEmail(
      buildInstantQuoteEmailDetails(rawInput({ name: "<script>alert(1)</script>" }), okResult())
    );
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  describe("hostile input", () => {
    it("escapes a <script> tag in the customer name", () => {
      const { html } = buildInstantQuoteCustomerEmail(
        buildInstantQuoteEmailDetails(rawInput({ name: '<script>alert("x")</script>' }), okResult())
      );
      expect(html).not.toContain('<script>alert("x")</script>');
      expect(html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
    });

    it("escapes an inline tag embedded in the service address (manual-review summary path)", () => {
      const { html } = buildInstantQuoteCustomerEmail(
        buildInstantQuoteEmailDetails(
          rawInput({ serviceAddress: { line1: "123 <b>Main</b> St", zip: "75056" } }),
          okResult({ estimateType: "manual_review", range: null })
        )
      );
      expect(html).not.toContain("<b>Main</b>");
      expect(html).toContain("123 &lt;b&gt;Main&lt;/b&gt; St");
    });

    it("plain-text body is never HTML-escaped", () => {
      // The customer email greets by first name only ("Hi {firstName},"),
      // so use a name with no internal whitespace to keep the special
      // characters inside that first token.
      const { text } = buildInstantQuoteCustomerEmail(
        buildInstantQuoteEmailDetails(rawInput({ name: "O'Brien&Sons" }), okResult())
      );
      expect(text).toContain("Hi O'Brien&Sons,");
      expect(text).not.toContain("&amp;");
    });

    it("subject lines are fixed strings and never interpolate the customer name, so no header-injection surface exists there", () => {
      const automatic = buildInstantQuoteCustomerEmail(
        buildInstantQuoteEmailDetails(rawInput({ name: "Jane\r\nBcc: attacker@evil.example" }), okResult())
      );
      expect(automatic.subject).toBe("Your CleanPerfecto Cleaning Estimate");
      expect(automatic.subject).not.toMatch(/[\r\n]/);

      const manual = buildInstantQuoteCustomerEmail(
        buildInstantQuoteEmailDetails(
          rawInput({ name: "Jane\r\nBcc: attacker@evil.example" }),
          okResult({ estimateType: "manual_review", range: null })
        )
      );
      expect(manual.subject).toBe("We Received Your CleanPerfecto Quote Request");
      expect(manual.subject).not.toMatch(/[\r\n]/);
    });
  });
});

describe("buildInstantQuoteCustomerEmail — starting-at", () => {
  it("clearly labels the estimate as starting-at rather than final", () => {
    const { text } = buildInstantQuoteCustomerEmail(
      buildInstantQuoteEmailDetails(rawInput(), okResult({ hasStartingAtPricing: true }))
    );
    expect(text).toContain("Starting at $110 – $130");
    expect(text).toContain(
      "Final pricing may be confirmed if the condition or selected starting-at services require additional review."
    );
  });
});

describe("buildInstantQuoteCustomerEmail — prepaid package", () => {
  function packageResult(overrides: Partial<OkResult> = {}) {
    return okResult({
      prepaidPackageTotal: 700.01,
      effectivePricePerVisit: 116.67,
      ...overrides,
    });
  }

  it("shows visit count, package total, and effective price per visit", () => {
    const { text } = buildInstantQuoteCustomerEmail(
      buildInstantQuoteEmailDetails(
        rawInput({ isPrepaidPackage: true, visitCount: 6, frequency: "weekly" }),
        packageResult()
      )
    );
    expect(text).toContain("Number of visits: 6");
    expect(text).toContain("Estimated prepaid package total: $700.01");
    expect(text).toContain("Effective price per visit: $116.67");
  });

  it("labels the total as starting-at when starting-at add-ons are present, not a guaranteed total", () => {
    const { text } = buildInstantQuoteCustomerEmail(
      buildInstantQuoteEmailDetails(
        rawInput({ isPrepaidPackage: true, visitCount: 6, frequency: "weekly" }),
        packageResult({ hasStartingAtPricing: true, prepaidPackageTotal: 740.01 })
      )
    );
    expect(text).toContain("Starting at: $740.01");
    expect(text).not.toContain("Estimated prepaid package total");
  });

  it("never mentions payment or a payment link", () => {
    const { text, html } = buildInstantQuoteCustomerEmail(
      buildInstantQuoteEmailDetails(
        rawInput({ isPrepaidPackage: true, visitCount: 6, frequency: "weekly" }),
        packageResult()
      )
    );
    expect(text.toLowerCase()).not.toContain("pay now");
    expect(text.toLowerCase()).not.toContain("checkout");
    expect(html.toLowerCase()).not.toContain("<a href");
  });
});

describe("buildInstantQuoteCustomerEmail — manual review", () => {
  function manualReviewResult(overrides: Partial<OkResult> = {}) {
    return okResult({
      estimateType: "manual_review",
      range: null,
      calculatedTotal: 0,
      manualReviewRequired: true,
      manualReviewReasons: ["ZIP_MANUAL_REVIEW_REQUIRED"],
      ...overrides,
    });
  }

  it("never invents a price", () => {
    const { text } = buildInstantQuoteCustomerEmail(
      buildInstantQuoteEmailDetails(rawInput(), manualReviewResult())
    );
    expect(text).not.toMatch(/\$\d/);
  });

  it("says the team will confirm pricing", () => {
    const { text } = buildInstantQuoteCustomerEmail(
      buildInstantQuoteEmailDetails(rawInput(), manualReviewResult())
    );
    expect(text).toContain("Your service requires a quick review so we can confirm the right scope and pricing.");
    expect(text).toContain("Our team will contact you using the information provided.");
  });

  it("never displays internal manual-review reason codes", () => {
    const { text, html } = buildInstantQuoteCustomerEmail(
      buildInstantQuoteEmailDetails(
        rawInput(),
        manualReviewResult({ manualReviewReasons: ["ZIP_MANUAL_REVIEW_REQUIRED", "CUSTOMER_IDENTITY_CONFLICT"] })
      )
    );
    expect(text).not.toContain("ZIP_MANUAL_REVIEW_REQUIRED");
    expect(text).not.toContain("CUSTOMER_IDENTITY_CONFLICT");
    expect(html).not.toContain("ZIP_MANUAL_REVIEW_REQUIRED");
    expect(html).not.toContain("CUSTOMER_IDENTITY_CONFLICT");
  });

  it("uses the manual-review subject line", () => {
    const { subject } = buildInstantQuoteCustomerEmail(
      buildInstantQuoteEmailDetails(rawInput(), manualReviewResult())
    );
    expect(subject).toBe("We Received Your CleanPerfecto Quote Request");
  });

  it("still includes a request reference and basic service summary", () => {
    const { text } = buildInstantQuoteCustomerEmail(
      buildInstantQuoteEmailDetails(rawInput(), manualReviewResult())
    );
    expect(text).toContain("22222222-2222-2222-2222-222222222222");
    expect(text).toContain("Property: Home");
  });
});
