import { describe, expect, it } from "vitest";
import { hashPdfBytes, resolveSignedConsentDocumentStorage, SignedConsentDocumentConflictError } from "./signed-consent-document-store";
import { generateConsentPdf } from "./generate-consent-pdf";
import { createFakeRawObjectStorage, createFakeSignedConsentDocumentStore } from "./test-support/fake-signed-consent-document-store";

describe("hashPdfBytes", () => {
  it("is stable — hashing the same stored bytes twice yields the same sha256, so a later integrity check against the recorded hash is meaningful", async () => {
    const bytes = await generateConsentPdf({
      consentId: "consent-1",
      customerId: "customer-1",
      consentTitle: "CleanPerfecto Service Consent Agreement",
      consentVersionLabel: "CP-CONSENT-2026-01",
      acceptedTextSnapshot: "TEXT",
      signedName: "Jane Doe",
      signedAt: new Date("2026-08-24T00:00:00.000Z"),
    });

    expect(hashPdfBytes(bytes)).toBe(hashPdfBytes(bytes));
    expect(hashPdfBytes(bytes)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("produces a different digest for different bytes", () => {
    expect(hashPdfBytes(new TextEncoder().encode("a"))).not.toBe(hashPdfBytes(new TextEncoder().encode("b")));
  });
});

describe("resolveSignedConsentDocumentStorage", () => {
  it("uploads when no object exists yet at the deterministic path", async () => {
    const { storage, state } = createFakeRawObjectStorage();
    const bytes = new TextEncoder().encode("pdf-bytes");
    const sha256 = hashPdfBytes(bytes);

    const result = await resolveSignedConsentDocumentStorage(storage, "customer-1/file.pdf", bytes, sha256);

    expect(result).toEqual({ path: "customer-1/file.pdf", sha256 });
    expect(state.objects.get("customer-1/file.pdf")).toBe(bytes);
  });

  it("adopts (never re-uploads) an existing object whose sha256 matches — the successful-upload-then-failed-DB-write recovery path", async () => {
    const { storage, state } = createFakeRawObjectStorage();
    const bytes = new TextEncoder().encode("identical-bytes");
    const sha256 = hashPdfBytes(bytes);
    state.objects.set("customer-1/file.pdf", bytes);

    const uploadSpy = storage.upload;
    let uploadCalled = false;
    storage.upload = async (...args) => {
      uploadCalled = true;
      return uploadSpy(...args);
    };

    const result = await resolveSignedConsentDocumentStorage(storage, "customer-1/file.pdf", bytes, sha256);

    expect(result).toEqual({ path: "customer-1/file.pdf", sha256 });
    expect(uploadCalled).toBe(false);
  });

  it("rejects and never overwrites when an existing object's sha256 differs — reports a conflict instead", async () => {
    const { storage, state } = createFakeRawObjectStorage();
    const existingBytes = new TextEncoder().encode("existing-different-bytes");
    state.objects.set("customer-1/file.pdf", existingBytes);
    const newBytes = new TextEncoder().encode("newly-generated-bytes");
    const newSha256 = hashPdfBytes(newBytes);

    await expect(resolveSignedConsentDocumentStorage(storage, "customer-1/file.pdf", newBytes, newSha256)).rejects.toThrow(SignedConsentDocumentConflictError);
    expect(state.objects.get("customer-1/file.pdf")).toBe(existingBytes); // never overwritten
  });
});

describe("createFakeSignedConsentDocumentStore", () => {
  it("stores the generated PDF under {customer_id}/{filename} and returns a sha256 matching the exact bytes stored", async () => {
    const { store, state } = createFakeSignedConsentDocumentStore();

    const result = await store.generateAndStore({
      consentId: "consent-1",
      customerId: "customer-1",
      consentTitle: "CleanPerfecto Service Consent Agreement",
      consentVersionLabel: "CP-CONSENT-2026-01",
      acceptedTextSnapshot: "TEXT",
      signedName: "Christine Smith",
      signedAt: new Date("2026-08-24T00:00:00.000Z"),
    });

    expect(result.path).toBe("customer-1/CleanPerfecto_Consent_Christine_Smith_CP-CONSENT-2026-01_2026-08-24.pdf");
    const storedBytes = state.objects.get(result.path);
    expect(storedBytes).toBeDefined();
    expect(hashPdfBytes(storedBytes!)).toBe(result.sha256);
  });

  it("simulates a generation failure exactly once when configured, then succeeds on retry", async () => {
    const { store, state } = createFakeSignedConsentDocumentStore({ failNextGeneration: true });
    const input = {
      consentId: "consent-1",
      customerId: "customer-1",
      consentTitle: "CleanPerfecto Service Consent Agreement",
      consentVersionLabel: "CP-CONSENT-2026-01",
      acceptedTextSnapshot: "TEXT",
      signedName: "Jane Doe",
      signedAt: new Date("2026-08-24T00:00:00.000Z"),
    };

    await expect(store.generateAndStore(input)).rejects.toThrow();
    expect(state.objects.size).toBe(0);

    const result = await store.generateAndStore(input);
    expect(result.path).toContain("customer-1/");
    expect(state.generateCallCount).toBe(2);
  });

  it("repeated calls with identical deterministic input adopt the already-stored object rather than erroring or duplicating", async () => {
    const { store, state } = createFakeSignedConsentDocumentStore();
    const input = {
      consentId: "consent-1",
      customerId: "customer-1",
      consentTitle: "CleanPerfecto Service Consent Agreement",
      consentVersionLabel: "CP-CONSENT-2026-01",
      acceptedTextSnapshot: "TEXT",
      signedName: "Jane Doe",
      signedAt: new Date("2026-08-24T00:00:00.000Z"),
    };

    const first = await store.generateAndStore(input);
    const second = await store.generateAndStore(input);

    expect(second).toEqual(first);
    expect(state.objects.size).toBe(1);
  });
});
