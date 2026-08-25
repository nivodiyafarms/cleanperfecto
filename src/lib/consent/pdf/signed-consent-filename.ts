export interface SignedConsentFilenameInput {
  /** MUST be the immutable customer_consents.signed_name evidence field — never a current/live customer profile name. There is deliberately no separate "customer name" input anywhere in this module; signedName is the only name this code ever sees. */
  signedName: string;
  consentVersionLabel: string;
  signedAt: Date;
}

// Combining Diacritical Marks block (U+0300–U+036F), built from explicit
// code points to avoid embedding literal combining characters in source.
const DIACRITICS_PATTERN = new RegExp(`[\\u0300-\\u036f]`, "g");

/**
 * CleanPerfecto_Consent_<SignedName>_<ConsentVersion>_<SignedDate>.pdf —
 * e.g. CleanPerfecto_Consent_Christine_Smith_CP-CONSENT-2026-01_2026-08-24.pdf
 * Never includes email/phone. consentVersionLabel is an internal,
 * already-filename-safe identifier (e.g. "CP-CONSENT-2026-01") and is used
 * as-is; only the signed name is sanitized.
 */
export function buildSignedConsentFilename(input: SignedConsentFilenameInput): string {
  const sanitizedName =
    input.signedName
      .normalize("NFKD")
      .replace(DIACRITICS_PATTERN, "") // strip diacritics (e.g. e-acute -> e) before sanitizing
      .replace(/[^a-zA-Z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "Customer";

  const signedDate = input.signedAt.toISOString().slice(0, 10); // YYYY-MM-DD (UTC) — a filename component, not a business timezone calculation

  return `CleanPerfecto_Consent_${sanitizedName}_${input.consentVersionLabel}_${signedDate}.pdf`;
}

/** signed-consents/{customer_id}/{filename} — the customer_id folder is what makes ownership verifiable at the storage-path layer (see assertCustomerOwnsDocumentPath). */
export function buildSignedConsentDocumentPath(customerId: string, filename: string): string {
  return `${customerId}/${filename}`;
}
