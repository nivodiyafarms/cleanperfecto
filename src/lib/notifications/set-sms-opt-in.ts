import type { CustomerNotificationPreferencesRecord, CustomerNotificationPreferencesRepository } from "./customer-notification-preferences-repository";

/**
 * The one place a customer's SMS opt-in/opt-out is ever recorded. Thin on
 * purpose — this is the bare-minimum consent gate needed before any SMS
 * channel could ever be used (still no live SMS provider exists — see
 * sms-sender.ts), not the fuller consent-capture workflow, which belongs to
 * the Consent + Review Automation milestone.
 */
export async function setSmsOptIn(
  repo: CustomerNotificationPreferencesRepository,
  customerId: string,
  optIn: boolean,
  source: string
): Promise<CustomerNotificationPreferencesRecord> {
  return repo.setSmsOptIn(customerId, optIn, source);
}
