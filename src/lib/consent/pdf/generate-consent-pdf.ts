import "server-only";

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export interface ConsentPdfInput {
  consentId: string;
  customerId: string;
  consentTitle: string;
  consentVersionLabel: string;
  /** The immutable, frozen text the customer actually accepted — never the current/live consent_versions.body_text. */
  acceptedTextSnapshot: string;
  signedName: string;
  signedAt: Date;
}

/**
 * The logical content model for the signed-document PDF, built BEFORE any
 * layout/wrapping happens. Kept as its own step (rather than inlined into
 * generateConsentPdf) specifically so a test can assert acceptedTextSnapshot
 * flows through byte-for-byte, independent of pdf-lib's rendering/wrapping.
 */
export interface ConsentPdfContent {
  organizationName: string;
  title: string;
  consentVersionLabel: string;
  customerId: string;
  consentId: string;
  acceptedTextSnapshot: string;
  signedName: string;
  signedAtIso: string;
}

export function buildConsentPdfContent(input: ConsentPdfInput): ConsentPdfContent {
  return {
    organizationName: "CleanPerfecto",
    title: input.consentTitle,
    consentVersionLabel: input.consentVersionLabel,
    customerId: input.customerId,
    consentId: input.consentId,
    acceptedTextSnapshot: input.acceptedTextSnapshot,
    signedName: input.signedName,
    signedAtIso: input.signedAt.toISOString(),
  };
}

const PAGE_SIZE: [number, number] = [612, 792]; // US Letter, points
const MARGIN = 54;
const BODY_SIZE = 10;
const LINE_GAP = 4;

/**
 * Renders the signed agreement as a standalone PDF — the retained,
 * easily-retrievable copy of what was signed, independent of the
 * customer_consents row itself. Always built from acceptedTextSnapshot
 * (never re-read from the live consent_versions text), so a PDF generated
 * today or regenerated on retry next year contains identical wording.
 *
 * Deterministic output is a hard requirement, not a nicety:
 * resolveSignedConsentDocumentStorage (signed-consent-document-store.ts)
 * adopts an existing stored object only when regenerating from the same
 * frozen evidence produces the SAME sha256 — a legitimate retry must never
 * be mistaken for a conflicting document. pdf-lib's PDFDocument.create()
 * embeds the real wall-clock time as CreationDate/ModDate by default,
 * which would make every regeneration hash differently even for
 * byte-identical content (confirmed empirically during disposable-Postgres
 * validation). Pinning both dates to the immutable signedAt evidence below
 * is what makes generateConsentPdf itself a pure function of its input.
 */
export async function generateConsentPdf(input: ConsentPdfInput): Promise<Uint8Array> {
  const content = buildConsentPdfContent(input);

  const doc = await PDFDocument.create();
  doc.setCreationDate(input.signedAt);
  doc.setModificationDate(input.signedAt);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);
  const textColor = rgb(0.09, 0.14, 0.24);
  const maxWidth = PAGE_SIZE[0] - MARGIN * 2;

  let page = doc.addPage(PAGE_SIZE);
  let cursorY = PAGE_SIZE[1] - MARGIN;

  function ensureSpace(size: number) {
    if (cursorY - size < MARGIN) {
      page = doc.addPage(PAGE_SIZE);
      cursorY = PAGE_SIZE[1] - MARGIN;
    }
  }

  function drawLine(text: string, options: { bold?: boolean; size?: number } = {}) {
    const size = options.size ?? BODY_SIZE;
    ensureSpace(size);
    page.drawText(text, { x: MARGIN, y: cursorY, size, font: options.bold ? boldFont : font, color: textColor });
    cursorY -= size + LINE_GAP;
  }

  function wrapLine(text: string, size: number, useFont: typeof font): string[] {
    const words = text.split(/\s+/).filter(Boolean);
    if (words.length === 0) return [""];
    const lines: string[] = [];
    let current = "";
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (current && useFont.widthOfTextAtSize(candidate, size) > maxWidth) {
        lines.push(current);
        current = word;
      } else {
        current = candidate;
      }
    }
    if (current) lines.push(current);
    return lines;
  }

  function drawParagraphs(text: string, options: { bold?: boolean; size?: number } = {}) {
    const size = options.size ?? BODY_SIZE;
    const useFont = options.bold ? boldFont : font;
    for (const rawLine of text.split("\n")) {
      if (rawLine.trim() === "") {
        cursorY -= size + LINE_GAP;
        continue;
      }
      for (const line of wrapLine(rawLine, size, useFont)) {
        ensureSpace(size);
        page.drawText(line, { x: MARGIN, y: cursorY, size, font: useFont, color: textColor });
        cursorY -= size + LINE_GAP;
      }
    }
  }

  drawLine(content.organizationName, { bold: true, size: 16 });
  drawLine(content.title, { bold: true, size: 13 });
  cursorY -= 6;
  drawLine(`Consent version: ${content.consentVersionLabel}`);
  drawLine(`Customer reference: ${content.customerId}`);
  drawLine(`Consent record: ${content.consentId}`);
  cursorY -= 10;

  drawParagraphs(content.acceptedTextSnapshot);

  cursorY -= 16;
  drawLine("ELECTRONIC SIGNATURE", { bold: true, size: 11 });
  drawParagraphs(
    `Signed by (typed legal name): ${content.signedName}\nSigned at: ${content.signedAtIso}\nThis document was executed electronically. The typed name above, together with the customer's submission of this form, constitutes the customer's electronic signature and acknowledgment of the complete agreement text reproduced above exactly as presented at the time of signing.`
  );

  return doc.save();
}
