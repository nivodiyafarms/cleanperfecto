import type { CustomerNotificationPreferencesRecord, CustomerNotificationPreferencesRepository } from "../customer-notification-preferences-repository";

export function createFakeCustomerNotificationPreferencesRepository(
  seed: Record<string, boolean> = {}
): { repo: CustomerNotificationPreferencesRepository; state: Map<string, CustomerNotificationPreferencesRecord> } {
  const state = new Map<string, CustomerNotificationPreferencesRecord>();
  for (const [customerId, smsOptIn] of Object.entries(seed)) {
    state.set(customerId, { customerId, smsOptIn, smsOptInAt: smsOptIn ? new Date() : null, smsOptInSource: smsOptIn ? "seed" : null, smsOptOutAt: null });
  }

  const repo: CustomerNotificationPreferencesRepository = {
    async findByCustomerId(customerId) {
      return state.get(customerId) ?? null;
    },
    async setSmsOptIn(customerId, optIn, source) {
      const now = new Date();
      const existing = state.get(customerId);
      const updated: CustomerNotificationPreferencesRecord = {
        customerId,
        smsOptIn: optIn,
        smsOptInAt: optIn ? now : (existing?.smsOptInAt ?? null),
        smsOptInSource: optIn ? source : (existing?.smsOptInSource ?? null),
        smsOptOutAt: optIn ? null : now,
      };
      state.set(customerId, updated);
      return updated;
    },
  };

  return { repo, state };
}
