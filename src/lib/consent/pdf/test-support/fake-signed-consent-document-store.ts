import { generateConsentPdf } from "../generate-consent-pdf";
import { buildSignedConsentDocumentPath, buildSignedConsentFilename } from "../signed-consent-filename";
import { hashPdfBytes, resolveSignedConsentDocumentStorage } from "../signed-consent-document-store";
import type { RawSignedConsentObjectStorage, SignedConsentDocumentInput, SignedConsentDocumentResult, SignedConsentDocumentStore } from "../signed-consent-document-store";

export interface FakeRawObjectStorageState {
  /** path -> stored bytes, mirroring the private Storage bucket. */
  objects: Map<string, Uint8Array>;
}

/** In-memory RawSignedConsentObjectStorage — upload() mirrors upsert:false by refusing to overwrite an existing path. */
export function createFakeRawObjectStorage(): { storage: RawSignedConsentObjectStorage; state: FakeRawObjectStorageState } {
  const objects = new Map<string, Uint8Array>();
  const storage: RawSignedConsentObjectStorage = {
    async downloadIfExists(path) {
      return objects.get(path) ?? null;
    },
    async upload(path, bytes) {
      if (objects.has(path)) {
        throw new Error(`[fake-raw-object-storage] object already exists at ${path}`);
      }
      objects.set(path, bytes);
    },
  };
  return { storage, state: { objects } };
}

export interface FakeSignedConsentDocumentStoreOptions {
  /** Simulates a PDF-generation/storage failure (e.g. a Storage outage) without touching real Supabase — used to test sign-consent.ts's failure handling. */
  failNextGeneration?: boolean;
}

export interface FakeSignedConsentDocumentStoreState {
  objects: Map<string, Uint8Array>;
  generateCallCount: number;
}

/**
 * In-memory SignedConsentDocumentStore for unit tests. Uses the REAL
 * generateConsentPdf/hashPdfBytes/filename/path helpers AND the real
 * resolveSignedConsentDocumentStorage conflict/adoption algorithm (so
 * tests exercise genuine PDF bytes, a genuine sha256, and genuine
 * idempotent-recovery behavior), storing bytes in a Map instead of
 * Supabase Storage — no network calls, fully deterministic.
 */
export function createFakeSignedConsentDocumentStore(options: FakeSignedConsentDocumentStoreOptions = {}): {
  store: SignedConsentDocumentStore;
  state: FakeSignedConsentDocumentStoreState;
} {
  const { storage: rawStorage, state: rawState } = createFakeRawObjectStorage();
  let failNext = options.failNextGeneration ?? false;
  let generateCallCount = 0;

  const store: SignedConsentDocumentStore = {
    async generateAndStore(input: SignedConsentDocumentInput): Promise<SignedConsentDocumentResult> {
      generateCallCount += 1;
      if (failNext) {
        failNext = false;
        throw new Error("[fake-consent-document-store] simulated generation/storage failure");
      }

      const pdfBytes = await generateConsentPdf(input);
      const sha256 = hashPdfBytes(pdfBytes);
      const filename = buildSignedConsentFilename({ signedName: input.signedName, consentVersionLabel: input.consentVersionLabel, signedAt: input.signedAt });
      const path = buildSignedConsentDocumentPath(input.customerId, filename);

      return resolveSignedConsentDocumentStorage(rawStorage, path, pdfBytes, sha256);
    },
  };

  return {
    store,
    state: {
      objects: rawState.objects,
      get generateCallCount() {
        return generateCallCount;
      },
    },
  };
}
