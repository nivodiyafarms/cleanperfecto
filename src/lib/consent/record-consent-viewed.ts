import type { ConsentRepository } from "./consent-repository";

/** Called when the customer's /my/consent page renders for the active version — advances sent -> viewed only; a no-op if already viewed/declined/signed or if no request exists yet for the active version at all. */
export async function recordConsentViewed(consentRepo: ConsentRepository, customerId: string): Promise<void> {
  const activeVersion = await consentRepo.findActiveVersion();
  if (!activeVersion) return;

  const record = await consentRepo.findByCustomerAndVersion(customerId, activeVersion.id);
  if (!record || record.state !== "sent") return;

  await consentRepo.markViewed(record.id);
}
