import type { ConsentRepository, CustomerConsentRecord } from "./consent-repository";
import { InvalidConsentStateError } from "./errors";

/**
 * Customer declines the active consent version — sent/viewed -> declined.
 * NOT terminal: the customer may return and sign the same active version
 * later (see the DB trigger, which only freezes on 'signed').
 */
export async function declineConsent(consentRepo: ConsentRepository, customerId: string): Promise<CustomerConsentRecord> {
  const activeVersion = await consentRepo.findActiveVersion();
  if (!activeVersion) {
    throw new InvalidConsentStateError("No active consent version is configured.");
  }
  const record = await consentRepo.findByCustomerAndVersion(customerId, activeVersion.id);
  if (!record) {
    throw new InvalidConsentStateError("No consent request found for the active version.");
  }
  return consentRepo.markDeclined(record.id);
}
