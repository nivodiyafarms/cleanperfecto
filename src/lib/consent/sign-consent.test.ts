import { describe, expect, it, vi } from "vitest";
import { InvalidConsentStateError } from "./errors";
import { createFakeSchedulingRepository } from "@/lib/scheduling/test-support/fake-scheduling-repository";
import { signConsent } from "./sign-consent";
import { createFakeConsentRepository } from "./test-support/fake-consent-repository";
import { createFakeSignedConsentDocumentStore } from "./pdf/test-support/fake-signed-consent-document-store";

function baseInput(overrides: Partial<Parameters<typeof signConsent>[2]> = {}) {
  return {
    customerId: "customer-1",
    signedName: "Jane Doe",
    agreedToTerms: true,
    ipAddress: "203.0.113.5",
    userAgent: "test-agent",
    ...overrides,
  };
}

describe("signConsent", () => {
  it("refuses to sign without a typed name", async () => {
    const { repo: consentRepo } = createFakeConsentRepository();
    const { repo: schedulingRepo } = createFakeSchedulingRepository();
    await expect(signConsent(consentRepo, schedulingRepo, baseInput({ signedName: "  " }))).rejects.toThrow(InvalidConsentStateError);
  });

  it("refuses to sign without the acknowledgment", async () => {
    const { repo: consentRepo } = createFakeConsentRepository();
    const { repo: schedulingRepo } = createFakeSchedulingRepository();
    await expect(signConsent(consentRepo, schedulingRepo, baseInput({ agreedToTerms: false }))).rejects.toThrow(InvalidConsentStateError);
  });

  it("one acknowledgment plus a typed name signs the complete agreement", async () => {
    const { repo: consentRepo } = createFakeConsentRepository();
    const { repo: schedulingRepo } = createFakeSchedulingRepository();
    const record = await signConsent(consentRepo, schedulingRepo, baseInput());
    expect(record.state).toBe("signed");
    expect(record.signedName).toBe("Jane Doe");
    expect(record.acceptedTextSnapshot).toBeTruthy();
  });

  it("records acceptanceMethod='typed_signature' — distinguishable in raw data from a clickwrap acceptance (consent evidence audit)", async () => {
    const { repo: consentRepo } = createFakeConsentRepository();
    const { repo: schedulingRepo } = createFakeSchedulingRepository();
    const record = await signConsent(consentRepo, schedulingRepo, baseInput());
    expect(record.acceptanceMethod).toBe("typed_signature");
  });

  it("does not block signing when IP/user-agent are unavailable", async () => {
    const { repo: consentRepo } = createFakeConsentRepository();
    const { repo: schedulingRepo } = createFakeSchedulingRepository();
    const record = await signConsent(consentRepo, schedulingRepo, baseInput({ ipAddress: null, userAgent: null }));
    expect(record.state).toBe("signed");
    expect(record.ipAddress).toBeNull();
    expect(record.userAgent).toBeNull();
  });

  it("freezes the exact snapshot/name/timestamp at sign time", async () => {
    const { repo: consentRepo, state } = createFakeConsentRepository();
    const { repo: schedulingRepo } = createFakeSchedulingRepository();
    const record = await signConsent(consentRepo, schedulingRepo, baseInput());

    expect(record.acceptedTextSnapshot).toBe(state.versions.get("version-1")?.bodyText);
    expect(record.signedName).toBe("Jane Doe");
    expect(record.signedAt).not.toBeNull();
  });

  it("a customer who declines may return and sign the same active version later", async () => {
    const { repo: consentRepo } = createFakeConsentRepository();
    const { repo: schedulingRepo } = createFakeSchedulingRepository();
    const { record: initial } = await consentRepo.insertSentRequest({ customerId: "customer-1", consentVersionId: "version-1", serviceVisitId: null });
    await consentRepo.markDeclined(initial.id);

    const signed = await signConsent(consentRepo, schedulingRepo, baseInput());

    expect(signed.state).toBe("signed");
    expect(signed.declinedAt).not.toBeNull(); // history preserved
  });

  it("signed snapshot is immutable — the repository rejects a second sign() call on an already-signed row (the fake mirror of the DB immutability trigger — proven for real against Postgres in disposable validation)", async () => {
    const { repo: consentRepo } = createFakeConsentRepository();
    const { record } = await consentRepo.insertSentRequest({ customerId: "customer-1", consentVersionId: "version-1", serviceVisitId: null });
    const signInput = {
      signedName: "Jane Doe",
      acceptedTextSnapshot: "text",
      ipAddress: null,
      userAgent: null,
    };
    await consentRepo.sign(record.id, signInput);

    await expect(consentRepo.sign(record.id, { ...signInput, signedName: "Attempted Overwrite" })).rejects.toThrow();
  });

  it("re-submitting an already-signed form is idempotent — returns the existing record, never re-signs", async () => {
    const { repo: consentRepo } = createFakeConsentRepository();
    const { repo: schedulingRepo } = createFakeSchedulingRepository();
    const first = await signConsent(consentRepo, schedulingRepo, baseInput({ signedName: "Jane Doe" }));
    const second = await signConsent(consentRepo, schedulingRepo, baseInput({ signedName: "Someone Else" }));

    expect(second.id).toBe(first.id);
    expect(second.signedName).toBe("Jane Doe"); // unchanged, not overwritten
  });

  it("cancels pending consent_reminder rows for the customer once signed", async () => {
    const { repo: consentRepo } = createFakeConsentRepository();
    const { repo: schedulingRepo, state: schedulingState } = createFakeSchedulingRepository();
    await schedulingRepo.insertServiceVisitNotification({
      serviceVisitId: "visit-1",
      customerId: "customer-1",
      notificationType: "consent_reminder",
      channel: "email",
      scheduledSendAt: new Date(),
      idempotencyKey: "customer-1:visit-1:consent_reminder:email:v1",
    });

    await signConsent(consentRepo, schedulingRepo, baseInput());

    const reminder = [...schedulingState.notifications.values()][0];
    expect(reminder.state).toBe("cancelled");
  });
});

describe("signConsent — signed-document generation", () => {
  it("generates and persists a signed-document PDF after a successful signature when a document store is supplied", async () => {
    const { repo: consentRepo } = createFakeConsentRepository();
    const { repo: schedulingRepo } = createFakeSchedulingRepository();
    const { store: documentStore } = createFakeSignedConsentDocumentStore();

    const record = await signConsent(consentRepo, schedulingRepo, baseInput(), documentStore);

    expect(record.state).toBe("signed");
    expect(record.signedDocumentPath).toBe("customer-1/CleanPerfecto_Consent_Jane_Doe_CP-CONSENT-2026-01_" + record.signedAt!.toISOString().slice(0, 10) + ".pdf");
    expect(record.signedDocumentSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("has no document at all when no document store is supplied (backward-compatible — existing callers/tests are unaffected)", async () => {
    const { repo: consentRepo } = createFakeConsentRepository();
    const { repo: schedulingRepo } = createFakeSchedulingRepository();

    const record = await signConsent(consentRepo, schedulingRepo, baseInput());

    expect(record.signedDocumentPath).toBeNull();
    expect(record.signedDocumentSha256).toBeNull();
  });

  it("preserves the signed consent (the legal signature) even when PDF generation/storage fails — the signature is never lost or rolled back", async () => {
    const { repo: consentRepo } = createFakeConsentRepository();
    const { repo: schedulingRepo } = createFakeSchedulingRepository();
    const { store: documentStore } = createFakeSignedConsentDocumentStore({ failNextGeneration: true });
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const record = await signConsent(consentRepo, schedulingRepo, baseInput(), documentStore);

    expect(record.state).toBe("signed");
    expect(record.signedName).toBe("Jane Doe");
    expect(record.signedDocumentPath).toBeNull(); // eligible for a later authorized retry
    expect(consoleErrorSpy).toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });
});

describe("signConsent — signed-document immutability (repository level)", () => {
  it("rejects a second setSignedDocument call once a document is already recorded — the signed PDF path/hash cannot be changed (the fake mirror of the DB immutability trigger; not yet validated against real Postgres since these migrations remain unapplied)", async () => {
    const { repo: consentRepo } = createFakeConsentRepository();
    const { record } = await consentRepo.insertSentRequest({ customerId: "customer-1", consentVersionId: "version-1", serviceVisitId: null });
    await consentRepo.sign(record.id, { signedName: "Jane Doe", acceptedTextSnapshot: "text", ipAddress: null, userAgent: null });

    const first = await consentRepo.setSignedDocument(record.id, { path: "customer-1/first.pdf", sha256: "a".repeat(64) });
    expect(first.signedDocumentPath).toBe("customer-1/first.pdf");

    await expect(consentRepo.setSignedDocument(record.id, { path: "customer-1/second.pdf", sha256: "b".repeat(64) })).rejects.toThrow();
  });

  it("refuses setSignedDocument on a row that isn't signed yet", async () => {
    const { repo: consentRepo } = createFakeConsentRepository();
    const { record } = await consentRepo.insertSentRequest({ customerId: "customer-1", consentVersionId: "version-1", serviceVisitId: null });

    await expect(consentRepo.setSignedDocument(record.id, { path: "customer-1/doc.pdf", sha256: "a".repeat(64) })).rejects.toThrow();
  });
});
