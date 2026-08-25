import { describe, expect, it } from "vitest";
import { declineConsent } from "./decline-consent";
import { InvalidConsentStateError } from "./errors";
import { createFakeConsentRepository } from "./test-support/fake-consent-repository";

describe("declineConsent", () => {
  it("moves sent -> declined", async () => {
    const { repo } = createFakeConsentRepository();
    await repo.insertSentRequest({ customerId: "customer-1", consentVersionId: "version-1", serviceVisitId: null });

    const record = await declineConsent(repo, "customer-1");

    expect(record.state).toBe("declined");
    expect(record.declinedAt).not.toBeNull();
  });

  it("refuses when no request exists for the active version", async () => {
    const { repo } = createFakeConsentRepository();
    await expect(declineConsent(repo, "customer-never-requested")).rejects.toThrow(InvalidConsentStateError);
  });
});
