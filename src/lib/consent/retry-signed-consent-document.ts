import type { ConsentRepository, CustomerConsentRecord } from "./consent-repository";
import { InvalidConsentStateError } from "./errors";
import type { SignedConsentDocumentStore } from "./pdf/signed-consent-document-store";

/**
 * Authorized retry for a signed consent whose PDF generation/storage
 * failed the first time (see sign-consent.ts). A no-op — never a second
 * attempt/overwrite — once a document is already recorded, matching the
 * DB trigger's own once-only guarantee.
 *
 * Always rebuilds the PDF from the ORIGINAL, immutable
 * record.acceptedTextSnapshot/signedName/signedAt — never the current
 * consent_versions text — so a retry produces exactly the document that
 * would have been generated at signing time, regardless of what a newer
 * consent version's wording now says.
 */
export async function retrySignedConsentDocument(consentRepo: ConsentRepository, documentStore: SignedConsentDocumentStore, consentId: string): Promise<CustomerConsentRecord> {
  const record = await consentRepo.findById(consentId);
  if (!record) {
    throw new InvalidConsentStateError("Consent record not found.");
  }
  if (record.state !== "signed") {
    throw new InvalidConsentStateError("Only a signed consent has a document to generate.");
  }
  if (record.signedDocumentPath) {
    return record; // already generated — never regenerate/overwrite
  }

  const version = await consentRepo.findVersionById(record.consentVersionId);

  const document = await documentStore.generateAndStore({
    consentId: record.id,
    customerId: record.customerId,
    consentTitle: version?.title ?? "CleanPerfecto Service Consent Agreement",
    consentVersionLabel: version?.versionLabel ?? record.consentVersionId,
    acceptedTextSnapshot: record.acceptedTextSnapshot!,
    signedName: record.signedName!,
    signedAt: record.signedAt!,
  });

  return consentRepo.setSignedDocument(record.id, document);
}
