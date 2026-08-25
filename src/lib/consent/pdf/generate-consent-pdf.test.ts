import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { buildConsentPdfContent, generateConsentPdf, type ConsentPdfInput } from "./generate-consent-pdf";

function baseInput(overrides: Partial<ConsentPdfInput> = {}): ConsentPdfInput {
  return {
    consentId: "consent-1",
    customerId: "customer-1",
    consentTitle: "CleanPerfecto Service Consent Agreement",
    consentVersionLabel: "CP-CONSENT-2026-01",
    acceptedTextSnapshot: "EXACT SNAPSHOT TEXT — line one.\nLine two.",
    signedName: "Jane Doe",
    signedAt: new Date("2026-08-24T15:04:05.000Z"),
    ...overrides,
  };
}

describe("buildConsentPdfContent", () => {
  it("carries the accepted_text_snapshot through byte-for-byte, unmodified", () => {
    const input = baseInput();
    const content = buildConsentPdfContent(input);
    expect(content.acceptedTextSnapshot).toBe(input.acceptedTextSnapshot);
  });

  it("never reads from anything other than the input snapshot — no reference to a live/current version text exists in the content model", () => {
    const content = buildConsentPdfContent(baseInput({ acceptedTextSnapshot: "ORIGINAL SIGNED TEXT" }));
    expect(content.acceptedTextSnapshot).toBe("ORIGINAL SIGNED TEXT");
    expect(content.signedName).toBe("Jane Doe");
    expect(content.signedAtIso).toBe("2026-08-24T15:04:05.000Z");
  });
});

describe("generateConsentPdf", () => {
  it("produces a valid, loadable PDF after signing", async () => {
    const bytes = await generateConsentPdf(baseInput());
    expect(bytes.byteLength).toBeGreaterThan(0);
    expect(Buffer.from(bytes.slice(0, 5)).toString("ascii")).toBe("%PDF-");

    const loaded = await PDFDocument.load(bytes);
    expect(loaded.getPageCount()).toBeGreaterThan(0);
  });

  it("produces more pages for a very long snapshot than a short one (content genuinely renders, not a static template)", async () => {
    const shortBytes = await generateConsentPdf(baseInput({ acceptedTextSnapshot: "Short text." }));
    const longSnapshot = Array.from({ length: 200 }, (_, i) => `Paragraph ${i}: this is a reasonably long line of agreement text to force wrapping and pagination.`).join("\n\n");
    const longBytes = await generateConsentPdf(baseInput({ acceptedTextSnapshot: longSnapshot }));

    const shortDoc = await PDFDocument.load(shortBytes);
    const longDoc = await PDFDocument.load(longBytes);
    expect(longDoc.getPageCount()).toBeGreaterThan(shortDoc.getPageCount());
  });

  it("is byte-for-byte deterministic across separate calls with identical input, even with real wall-clock time elapsed in between — regression test for a genuine bug found during disposable-Postgres validation: pdf-lib's PDFDocument.create() embeds the real current time as CreationDate/ModDate by default, which made two generations from the SAME immutable evidence hash differently and broke the partial-failure-recovery hash-adoption guarantee. Fixed by pinning both dates to the frozen signedAt evidence.", async () => {
    const input = baseInput();
    const first = await generateConsentPdf(input);
    await new Promise((resolve) => setTimeout(resolve, 1100)); // exceed pdf-lib's one-second date resolution
    const second = await generateConsentPdf(input);

    expect(Buffer.compare(first, second)).toBe(0);
  });
});
