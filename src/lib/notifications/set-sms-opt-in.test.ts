import { describe, expect, it } from "vitest";
import { setSmsOptIn } from "./set-sms-opt-in";
import { createFakeCustomerNotificationPreferencesRepository } from "./test-support/fake-customer-notification-preferences-repository";

describe("setSmsOptIn", () => {
  it("records an opt-in with its source and timestamp", async () => {
    const { repo, state } = createFakeCustomerNotificationPreferencesRepository();
    const result = await setSmsOptIn(repo, "customer-1", true, "portal_profile");
    expect(result.smsOptIn).toBe(true);
    expect(result.smsOptInSource).toBe("portal_profile");
    expect(result.smsOptInAt).not.toBeNull();
    expect(state.get("customer-1")?.smsOptIn).toBe(true);
  });

  it("records an opt-out, preserving the original opt-in timestamp for audit history", async () => {
    const { repo } = createFakeCustomerNotificationPreferencesRepository();
    await setSmsOptIn(repo, "customer-1", true, "portal_profile");
    const optedOut = await setSmsOptIn(repo, "customer-1", false, "portal_profile");
    expect(optedOut.smsOptIn).toBe(false);
    expect(optedOut.smsOptInAt).not.toBeNull(); // history preserved
    expect(optedOut.smsOptOutAt).not.toBeNull();
  });

  it("defaults to no opt-in for a customer with no preferences row yet", async () => {
    const { repo } = createFakeCustomerNotificationPreferencesRepository();
    const preferences = await repo.findByCustomerId("customer-never-set");
    expect(preferences).toBeNull();
  });
});
