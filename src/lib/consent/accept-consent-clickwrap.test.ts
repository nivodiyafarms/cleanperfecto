import { describe, expect, it } from "vitest";
import { acceptConsentClickwrap } from "./accept-consent-clickwrap";
import { ConsentVersionChangedError, InvalidConsentStateError } from "./errors";
import { createFakeSchedulingRepository } from "@/lib/scheduling/test-support/fake-scheduling-repository";
import { createFakeConsentRepository } from "./test-support/fake-consent-repository";

function baseInput(overrides: Partial<Parameters<typeof acceptConsentClickwrap>[2]> = {}) {
  return {
    customerId: "customer-1",
    presentedConsentVersionId: "version-1",
    ipAddress: "203.0.113.5",
    userAgent: "test-agent",
    ...overrides,
  };
}

describe("acceptConsentClickwrap", () => {
  it("accepts a valid consent presented against the current active version (6)", async () => {
    const { repo: consentRepo } = createFakeConsentRepository();
    const { repo: schedulingRepo } = createFakeSchedulingRepository();

    const record = await acceptConsentClickwrap(consentRepo, schedulingRepo, baseInput());

    expect(record.state).toBe("signed");
  });

  it("stores the exact active template/version accepted (7)", async () => {
    const { repo: consentRepo } = createFakeConsentRepository();
    const { repo: schedulingRepo } = createFakeSchedulingRepository();

    const record = await acceptConsentClickwrap(consentRepo, schedulingRepo, baseInput());

    expect(record.consentVersionId).toBe("version-1");
    expect(record.acceptedTextSnapshot).toContain("TEST CONSENT TEXT");
  });

  it("stores the accepted timestamp (8)", async () => {
    const { repo: consentRepo } = createFakeConsentRepository();
    const { repo: schedulingRepo } = createFakeSchedulingRepository();

    const record = await acceptConsentClickwrap(consentRepo, schedulingRepo, baseInput());

    expect(record.signedAt).not.toBeNull();
  });

  it("never requires or accepts a typed name — the recorded evidence name comes from the customer's own record, not caller input", async () => {
    const { repo: consentRepo } = createFakeConsentRepository({ customerNames: { "customer-1": "Jane Doe" } });
    const { repo: schedulingRepo } = createFakeSchedulingRepository();

    const record = await acceptConsentClickwrap(consentRepo, schedulingRepo, baseInput());

    expect(record.signedName).toBe("Jane Doe");
    // acceptConsentClickwrap's own input type has no signedName field at
    // all (enforced by TypeScript) — this is clickwrap, not a signature.
  });

  it("falls back to a generic name when the customer has none on record, rather than failing", async () => {
    const { repo: consentRepo } = createFakeConsentRepository();
    const { repo: schedulingRepo } = createFakeSchedulingRepository();

    const record = await acceptConsentClickwrap(consentRepo, schedulingRepo, baseInput());

    expect(record.signedName).toBe("CleanPerfecto customer");
  });

  it("rejects a presented version id that is not the active version — a fake/arbitrary template id is never trusted (9)", async () => {
    const { repo: consentRepo } = createFakeConsentRepository();
    const { repo: schedulingRepo } = createFakeSchedulingRepository();

    await expect(
      acceptConsentClickwrap(consentRepo, schedulingRepo, baseInput({ presentedConsentVersionId: "not-a-real-version-id" }))
    ).rejects.toThrow(ConsentVersionChangedError);
  });

  it("refuses to accept when no consent version is active at all", async () => {
    const { repo: consentRepo } = createFakeConsentRepository({ versions: [] });
    const { repo: schedulingRepo } = createFakeSchedulingRepository();

    await expect(acceptConsentClickwrap(consentRepo, schedulingRepo, baseInput())).rejects.toThrow(InvalidConsentStateError);
  });

  it("version-race: surfaces the new current version rather than silently signing the stale one the customer never saw (10)", async () => {
    const { repo: consentRepo } = createFakeConsentRepository({
      versions: [
        { id: "version-1", versionLabel: "CP-CONSENT-2026-01", title: "V1", bodyText: "old text", isLegallyReviewed: false, isActive: false },
        { id: "version-2", versionLabel: "CP-CONSENT-2026-02", title: "V2", bodyText: "new text", isLegallyReviewed: false, isActive: true },
      ],
    });
    const { repo: schedulingRepo } = createFakeSchedulingRepository();

    let caught: unknown;
    try {
      // The customer's page rendered version-1, but version-2 became
      // active before they submitted.
      await acceptConsentClickwrap(consentRepo, schedulingRepo, baseInput({ presentedConsentVersionId: "version-1" }));
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ConsentVersionChangedError);
    expect((caught as ConsentVersionChangedError).currentVersionId).toBe("version-2");

    // Resubmitting against the now-current version succeeds.
    const record = await acceptConsentClickwrap(consentRepo, schedulingRepo, baseInput({ presentedConsentVersionId: "version-2" }));
    expect(record.state).toBe("signed");
    expect(record.consentVersionId).toBe("version-2");
  });

  it("retried submission is idempotent — a second call for the same customer+version returns the existing signed record, never a duplicate (11)", async () => {
    const { repo: consentRepo, state } = createFakeConsentRepository();
    const { repo: schedulingRepo } = createFakeSchedulingRepository();

    const first = await acceptConsentClickwrap(consentRepo, schedulingRepo, baseInput());
    const second = await acceptConsentClickwrap(consentRepo, schedulingRepo, baseInput());

    expect(second.id).toBe(first.id);
    expect([...state.consents.values()].filter((c) => c.customerId === "customer-1")).toHaveLength(1);
  });

  it("an already-accepted record is immutable — the repository rejects overwriting a signed row (12)", async () => {
    const { repo: consentRepo } = createFakeConsentRepository();
    const { record } = await consentRepo.insertSentRequest({ customerId: "customer-1", consentVersionId: "version-1", serviceVisitId: null });
    await consentRepo.sign(record.id, { signedName: "Jane Doe", acceptedTextSnapshot: "text", ipAddress: null, userAgent: null });

    await expect(consentRepo.sign(record.id, { signedName: "Attempted Overwrite", acceptedTextSnapshot: "text", ipAddress: null, userAgent: null })).rejects.toThrow();
  });

  it("cancels pending consent_reminder rows for the customer once accepted", async () => {
    const { repo: consentRepo } = createFakeConsentRepository();
    const { repo: schedulingRepo, state: schedulingState } = createFakeSchedulingRepository();
    await schedulingRepo.insertServiceVisitNotification({
      serviceVisitId: "visit-1",
      customerId: "customer-1",
      notificationType: "consent_reminder",
      channel: "email",
      scheduledSendAt: new Date(),
      idempotencyKey: "customer-1:visit-1:consent_reminder:email:v1",
    });

    await acceptConsentClickwrap(consentRepo, schedulingRepo, baseInput());

    const reminder = [...schedulingState.notifications.values()][0];
    expect(reminder.state).toBe("cancelled");
  });

  it("does not block acceptance when IP/user-agent are unavailable", async () => {
    const { repo: consentRepo } = createFakeConsentRepository();
    const { repo: schedulingRepo } = createFakeSchedulingRepository();

    const record = await acceptConsentClickwrap(consentRepo, schedulingRepo, baseInput({ ipAddress: null, userAgent: null }));

    expect(record.state).toBe("signed");
  });
});
