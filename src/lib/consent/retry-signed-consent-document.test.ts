import { describe, expect, it } from "vitest";
import { InvalidConsentStateError } from "./errors";
import { retrySignedConsentDocument } from "./retry-signed-consent-document";
import { signConsent } from "./sign-consent";
import { createFakeConsentRepository } from "./test-support/fake-consent-repository";
import { createFakeSchedulingRepository } from "@/lib/scheduling/test-support/fake-scheduling-repository";
import { createFakeSignedConsentDocumentStore } from "./pdf/test-support/fake-signed-consent-document-store";
import { hashPdfBytes } from "./pdf/signed-consent-document-store";

describe("retrySignedConsentDocument", () => {
  it("refuses to retry a consent that was never signed", async () => {
    const { repo: consentRepo } = createFakeConsentRepository();
    const { store: documentStore } = createFakeSignedConsentDocumentStore();
    const { record } = await consentRepo.insertSentRequest({ customerId: "customer-1", consentVersionId: "version-1", serviceVisitId: null });

    await expect(retrySignedConsentDocument(consentRepo, documentStore, record.id)).rejects.toThrow(InvalidConsentStateError);
  });

  it("refuses to retry an unknown consent id", async () => {
    const { repo: consentRepo } = createFakeConsentRepository();
    const { store: documentStore } = createFakeSignedConsentDocumentStore();
    await expect(retrySignedConsentDocument(consentRepo, documentStore, "does-not-exist")).rejects.toThrow(InvalidConsentStateError);
  });

  it("generates and persists the document when none exists yet", async () => {
    const { repo: consentRepo } = createFakeConsentRepository();
    const { repo: schedulingRepo } = createFakeSchedulingRepository();
    // Sign WITHOUT a document store, simulating the original PDF generation having failed at sign time.
    const signed = await signConsent(consentRepo, schedulingRepo, { customerId: "customer-1", signedName: "Jane Doe", agreedToTerms: true, ipAddress: null, userAgent: null });
    expect(signed.signedDocumentPath).toBeNull();

    const { store: documentStore } = createFakeSignedConsentDocumentStore();
    const retried = await retrySignedConsentDocument(consentRepo, documentStore, signed.id);

    expect(retried.signedDocumentPath).not.toBeNull();
    expect(retried.signedDocumentSha256).not.toBeNull();
  });

  it("is a no-op — never regenerates/overwrites — once a document is already recorded", async () => {
    const { repo: consentRepo } = createFakeConsentRepository();
    const { repo: schedulingRepo } = createFakeSchedulingRepository();
    const { store: documentStore, state } = createFakeSignedConsentDocumentStore();
    const signed = await signConsent(consentRepo, schedulingRepo, { customerId: "customer-1", signedName: "Jane Doe", agreedToTerms: true, ipAddress: null, userAgent: null }, documentStore);
    expect(signed.signedDocumentPath).not.toBeNull();
    const generateCallsAfterSigning = state.generateCallCount;

    const retried = await retrySignedConsentDocument(consentRepo, documentStore, signed.id);

    expect(retried.signedDocumentPath).toBe(signed.signedDocumentPath);
    expect(state.generateCallCount).toBe(generateCallsAfterSigning); // never called again
  });

  it("uses the ORIGINAL signed accepted_text_snapshot, never a newer active consent version's text", async () => {
    const { repo: consentRepo, state: consentState } = createFakeConsentRepository({
      versions: [{ id: "version-1", versionLabel: "CP-CONSENT-2026-01", title: "CleanPerfecto Service Consent Agreement", bodyText: "ORIGINAL SIGNED TEXT", isLegallyReviewed: false, isActive: true }],
    });
    const { repo: schedulingRepo } = createFakeSchedulingRepository();
    const signed = await signConsent(consentRepo, schedulingRepo, { customerId: "customer-1", signedName: "Jane Doe", agreedToTerms: true, ipAddress: null, userAgent: null });
    expect(signed.acceptedTextSnapshot).toBe("ORIGINAL SIGNED TEXT");

    // A materially revised version becomes active later — the retry must NOT pick this up.
    const revisedVersion = { id: "version-2", versionLabel: "CP-CONSENT-2026-02", title: "CleanPerfecto Service Consent Agreement", bodyText: "REVISED TEXT — DO NOT USE FOR RETRY", isLegallyReviewed: false, isActive: true };
    consentState.versions.get("version-1")!.isActive = false;
    consentState.versions.set("version-2", revisedVersion);

    const generatedInputs: string[] = [];
    const { store: documentStore } = createFakeSignedConsentDocumentStore();
    const originalGenerateAndStore = documentStore.generateAndStore.bind(documentStore);
    documentStore.generateAndStore = async (input) => {
      generatedInputs.push(input.acceptedTextSnapshot);
      return originalGenerateAndStore(input);
    };

    await retrySignedConsentDocument(consentRepo, documentStore, signed.id);

    expect(generatedInputs).toEqual(["ORIGINAL SIGNED TEXT"]);
  });

  it("uses the immutable signed_name for the filename, never a current/profile name — retrySignedConsentDocument has no access to profile data at all, only the frozen consent record", async () => {
    const { repo: consentRepo } = createFakeConsentRepository();
    const { record } = await consentRepo.insertSentRequest({ customerId: "customer-1", consentVersionId: "version-1", serviceVisitId: null });
    const signed = await consentRepo.sign(record.id, { signedName: "Christine Smith", acceptedTextSnapshot: "TEXT", ipAddress: null, userAgent: null });

    const { store: documentStore } = createFakeSignedConsentDocumentStore();
    const retried = await retrySignedConsentDocument(consentRepo, documentStore, signed.id);

    expect(retried.signedDocumentPath).toBe(`customer-1/CleanPerfecto_Consent_Christine_Smith_CP-CONSENT-2026-01_${signed.signedAt!.toISOString().slice(0, 10)}.pdf`);
  });

  it("repairs a successful-upload-but-failed-DB-write (or a crash between the two): retry adopts the already-stored object instead of re-uploading or erroring", async () => {
    const { repo: consentRepo } = createFakeConsentRepository();
    const { record } = await consentRepo.insertSentRequest({ customerId: "customer-1", consentVersionId: "version-1", serviceVisitId: null });
    const signed = await consentRepo.sign(record.id, { signedName: "Jane Doe", acceptedTextSnapshot: "TEXT", ipAddress: null, userAgent: null });

    const { store: documentStore, state } = createFakeSignedConsentDocumentStore();
    // Simulate: PDF generated + Storage upload succeeded, but the DB write (setSignedDocument) never happened — e.g. the process crashed right after the upload.
    const uploaded = await documentStore.generateAndStore({
      consentId: signed.id,
      customerId: signed.customerId,
      consentTitle: "CleanPerfecto Service Consent Agreement",
      consentVersionLabel: "CP-CONSENT-2026-01",
      acceptedTextSnapshot: signed.acceptedTextSnapshot!,
      signedName: signed.signedName!,
      signedAt: signed.signedAt!,
    });
    expect(state.objects.size).toBe(1);
    expect(signed.signedDocumentPath).toBeNull(); // DB was never updated, matching the crash scenario

    const repaired = await retrySignedConsentDocument(consentRepo, documentStore, signed.id);

    expect(repaired.signedDocumentPath).toBe(uploaded.path);
    expect(repaired.signedDocumentSha256).toBe(uploaded.sha256);
    expect(state.objects.size).toBe(1); // never re-uploaded or duplicated
  });

  it("never alters the immutable signing evidence (accepted_text_snapshot/signed_name/signed_at) while repairing/generating a document", async () => {
    const { repo: consentRepo } = createFakeConsentRepository();
    const { repo: schedulingRepo } = createFakeSchedulingRepository();
    const signed = await signConsent(consentRepo, schedulingRepo, { customerId: "customer-1", signedName: "Jane Doe", agreedToTerms: true, ipAddress: null, userAgent: null });
    const before = { snapshot: signed.acceptedTextSnapshot, name: signed.signedName, at: signed.signedAt };

    const { store: documentStore } = createFakeSignedConsentDocumentStore();
    const retried = await retrySignedConsentDocument(consentRepo, documentStore, signed.id);

    expect(retried.acceptedTextSnapshot).toBe(before.snapshot);
    expect(retried.signedName).toBe(before.name);
    expect(retried.signedAt).toEqual(before.at);
  });

  it("the stored object's sha256 remains verifiable against the persisted signed_document_sha256 after a repair", async () => {
    const { repo: consentRepo } = createFakeConsentRepository();
    const { record } = await consentRepo.insertSentRequest({ customerId: "customer-1", consentVersionId: "version-1", serviceVisitId: null });
    const signed = await consentRepo.sign(record.id, { signedName: "Jane Doe", acceptedTextSnapshot: "TEXT", ipAddress: null, userAgent: null });

    const { store: documentStore, state } = createFakeSignedConsentDocumentStore();
    const uploaded = await documentStore.generateAndStore({
      consentId: signed.id,
      customerId: signed.customerId,
      consentTitle: "CleanPerfecto Service Consent Agreement",
      consentVersionLabel: "CP-CONSENT-2026-01",
      acceptedTextSnapshot: signed.acceptedTextSnapshot!,
      signedName: signed.signedName!,
      signedAt: signed.signedAt!,
    });

    const repaired = await retrySignedConsentDocument(consentRepo, documentStore, signed.id);

    const storedBytes = state.objects.get(repaired.signedDocumentPath!)!;
    expect(hashPdfBytes(storedBytes)).toBe(repaired.signedDocumentSha256);
    expect(uploaded.sha256).toBe(repaired.signedDocumentSha256);
  });
});
