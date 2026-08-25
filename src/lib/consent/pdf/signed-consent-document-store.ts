import "server-only";

import { createHash } from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { generateConsentPdf, type ConsentPdfInput } from "./generate-consent-pdf";
import { buildSignedConsentDocumentPath, buildSignedConsentFilename } from "./signed-consent-filename";

export const SIGNED_CONSENTS_BUCKET = "signed-consents";

export function hashPdfBytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export type SignedConsentDocumentInput = ConsentPdfInput;

export interface SignedConsentDocumentResult {
  path: string;
  sha256: string;
}

export class SignedConsentDocumentConflictError extends Error {
  constructor(
    public readonly path: string,
    public readonly expectedSha256: string,
    public readonly existingSha256: string
  ) {
    super(`Signed-consent PDF conflict at ${path}: newly generated sha256 ${expectedSha256} does not match the existing stored object's sha256 ${existingSha256}. Refusing to overwrite.`);
    this.name = "SignedConsentDocumentConflictError";
  }
}

/**
 * Generates + stores the signed-document PDF. Kept as its own small
 * interface (mirroring ConsentRepository/SchedulingRepository) so
 * sign-consent.ts and retry-signed-consent-document.ts can be unit-tested
 * against an in-memory fake instead of real Supabase Storage.
 */
export interface SignedConsentDocumentStore {
  generateAndStore(input: SignedConsentDocumentInput): Promise<SignedConsentDocumentResult>;
}

/**
 * The raw object-storage operations resolveSignedConsentDocumentStorage
 * needs — deliberately narrow (not the full Supabase Storage SDK shape) so
 * the conflict/adoption algorithm below can be unit-tested against a
 * trivial in-memory fake instead of mocking Supabase.
 */
export interface RawSignedConsentObjectStorage {
  /** Returns the object's bytes, or null if no object exists at this path. */
  downloadIfExists(path: string): Promise<Uint8Array | null>;
  /** Uploads new bytes. Callers only invoke this once they've established (via downloadIfExists) that nothing exists at path yet. */
  upload(path: string, bytes: Uint8Array, contentType: string): Promise<void>;
}

/**
 * The idempotent, crash-safe core of "store this signed document exactly
 * once": handles the case where a previous attempt got as far as a
 * successful Storage upload but never reached the DB write that records
 * signed_document_path/sha256 (a mid-request crash, or setSignedDocument
 * itself failing) — the next retry must neither error out on
 * upsert:false's "already exists" nor blindly overwrite what's there.
 *
 * - No object at the deterministic path yet -> upload it.
 * - An object already exists AND its sha256 matches the newly generated
 *   PDF -> the same valid document was already stored by an earlier
 *   attempt; adopt it (no re-upload) so the caller can simply repair the
 *   missing DB path/hash.
 * - An object already exists with a DIFFERENT sha256 -> something else is
 *   at this deterministic path (data corruption, or a logic error
 *   upstream); stop and surface SignedConsentDocumentConflictError rather
 *   than ever silently overwriting a stored legal document.
 */
export async function resolveSignedConsentDocumentStorage(
  rawStorage: RawSignedConsentObjectStorage,
  path: string,
  pdfBytes: Uint8Array,
  sha256: string
): Promise<SignedConsentDocumentResult> {
  const existingBytes = await rawStorage.downloadIfExists(path);

  if (existingBytes) {
    const existingSha256 = hashPdfBytes(existingBytes);
    if (existingSha256 !== sha256) {
      throw new SignedConsentDocumentConflictError(path, sha256, existingSha256);
    }
    return { path, sha256: existingSha256 };
  }

  await rawStorage.upload(path, pdfBytes, "application/pdf");
  return { path, sha256 };
}

export function createSupabaseSignedConsentDocumentStore(): SignedConsentDocumentStore {
  const supabase = createSupabaseAdminClient();

  const rawStorage: RawSignedConsentObjectStorage = {
    async downloadIfExists(path) {
      const { data, error } = await supabase.storage.from(SIGNED_CONSENTS_BUCKET).download(path);
      if (error || !data) return null;
      return new Uint8Array(await data.arrayBuffer());
    },
    async upload(path, bytes, contentType) {
      const { error } = await supabase.storage.from(SIGNED_CONSENTS_BUCKET).upload(path, bytes, {
        contentType,
        upsert: false, // never silently overwrite — resolveSignedConsentDocumentStorage's existence check above is the primary guard; this is a second line of defense against a genuine race
      });
      if (error) throw new Error(`[consent] signed-consent PDF upload failed: ${error.message}`);
    },
  };

  return {
    async generateAndStore(input) {
      const pdfBytes = await generateConsentPdf(input);
      const sha256 = hashPdfBytes(pdfBytes);
      const filename = buildSignedConsentFilename({ signedName: input.signedName, consentVersionLabel: input.consentVersionLabel, signedAt: input.signedAt });
      const path = buildSignedConsentDocumentPath(input.customerId, filename);

      return resolveSignedConsentDocumentStorage(rawStorage, path, pdfBytes, sha256);
    },
  };
}
