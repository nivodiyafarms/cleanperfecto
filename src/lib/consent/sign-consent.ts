import type { SchedulingRepository } from "@/lib/scheduling/repository";
import type { ConsentRepository, CustomerConsentRecord } from "./consent-repository";
import { InvalidConsentStateError } from "./errors";
import type { SignedConsentDocumentStore } from "./pdf/signed-consent-document-store";

export interface SignConsentInput {
  customerId: string;
  signedName: string;
  /** Single submission-gate acknowledgment for the ENTIRE agreement — validated but never persisted; the stored evidence is state='signed' + signedName + acceptedTextSnapshot + signedAt. */
  agreedToTerms: boolean;
  /** Supplemental audit evidence only — see consent-repository.ts. Never required for a successful sign. */
  ipAddress: string | null;
  userAgent: string | null;
}

/**
 * The one place a consent gets signed. Creates the underlying
 * customer_consents row on the fly (via the same insert-or-no-op path as
 * enqueueConsentRequest) if the customer navigates to /my/consent before
 * any request notification has been sent/dispatched yet — signing must
 * work regardless of dispatcher timing, since consent is non-blocking and
 * customer-initiated either way.
 *
 * Idempotent: re-submitting an already-signed form returns the existing
 * signed record unchanged rather than attempting a second write (which the
 * DB's immutability trigger would reject anyway) — a safe response to a
 * double-click, not an error.
 *
 * Cancels any pending consent_reminder for this customer's visits once
 * signed — a reminder that hasn't dispatched yet has nothing left to
 * remind about.
 *
 * documentStore is optional (same additive-DI convention used for
 * consentRepo/schedulingRepo elsewhere) so every pre-existing caller/test
 * keeps working unchanged. When supplied, a best-effort PDF is generated
 * and stored right after signing: the immutable DB signature record above
 * is ALWAYS the primary evidence and is never rolled back or blocked by a
 * document failure — a generation/storage error is logged and the signed
 * record is returned with signed_document_path/sha256 still null, ready
 * for a later authorized retry (see retry-signed-consent-document.ts).
 */
export async function signConsent(
  consentRepo: ConsentRepository,
  schedulingRepo: SchedulingRepository,
  input: SignConsentInput,
  documentStore?: SignedConsentDocumentStore
): Promise<CustomerConsentRecord> {
  const trimmedName = input.signedName.trim();
  if (!trimmedName) {
    throw new InvalidConsentStateError("A typed legal name is required to sign.");
  }
  if (!input.agreedToTerms) {
    throw new InvalidConsentStateError("You must acknowledge the agreement to sign.");
  }

  const activeVersion = await consentRepo.findActiveVersion();
  if (!activeVersion) {
    throw new InvalidConsentStateError("No active consent version is configured.");
  }

  const { record: existing } = await consentRepo.insertSentRequest({
    customerId: input.customerId,
    consentVersionId: activeVersion.id,
    serviceVisitId: null,
  });

  if (existing.state === "signed") {
    return existing;
  }

  const signed = await consentRepo.sign(existing.id, {
    signedName: trimmedName,
    acceptedTextSnapshot: activeVersion.bodyText,
    acceptanceMethod: "typed_signature",
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
  });

  await schedulingRepo.cancelPendingConsentRemindersForCustomer(input.customerId);

  if (!documentStore) {
    return signed;
  }

  try {
    const document = await documentStore.generateAndStore({
      consentId: signed.id,
      customerId: signed.customerId,
      consentTitle: activeVersion.title,
      consentVersionLabel: activeVersion.versionLabel,
      acceptedTextSnapshot: signed.acceptedTextSnapshot!,
      signedName: signed.signedName!,
      signedAt: signed.signedAt!,
    });
    return await consentRepo.setSignedDocument(signed.id, document);
  } catch (error) {
    console.error(`[consent] signed-document generation/storage failed for consent ${signed.id} — signature preserved, eligible for retry:`, error);
    return signed;
  }
}
