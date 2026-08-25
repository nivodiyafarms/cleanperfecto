import { describe, expect, it } from "vitest";
import { recordConsentViewed } from "./record-consent-viewed";
import { createFakeConsentRepository } from "./test-support/fake-consent-repository";

describe("recordConsentViewed", () => {
  it("advances sent -> viewed", async () => {
    const { repo, state } = createFakeConsentRepository();
    const { record } = await repo.insertSentRequest({ customerId: "customer-1", consentVersionId: "version-1", serviceVisitId: null });
    expect(record.state).toBe("sent");

    await recordConsentViewed(repo, "customer-1");

    const updated = state.consents.get("customer-1:version-1");
    expect(updated?.state).toBe("viewed");
    expect(updated?.viewedAt).not.toBeNull();
  });

  it("is a no-op when already viewed/declined/signed", async () => {
    const { repo, state } = createFakeConsentRepository();
    const { record } = await repo.insertSentRequest({ customerId: "customer-1", consentVersionId: "version-1", serviceVisitId: null });
    await repo.markDeclined(record.id);

    await recordConsentViewed(repo, "customer-1");

    expect(state.consents.get("customer-1:version-1")?.state).toBe("declined");
  });

  it("is a no-op when no request exists yet for the active version", async () => {
    const { repo } = createFakeConsentRepository();
    await expect(recordConsentViewed(repo, "customer-never-requested")).resolves.not.toThrow();
  });
});
