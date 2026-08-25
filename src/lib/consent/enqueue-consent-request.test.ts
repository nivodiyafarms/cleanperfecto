import { describe, expect, it } from "vitest";
import { createFakeSchedulingRepository } from "@/lib/scheduling/test-support/fake-scheduling-repository";
import { enqueueConsentRequest } from "./enqueue-consent-request";
import { createFakeConsentRepository } from "./test-support/fake-consent-repository";

describe("enqueueConsentRequest", () => {
  it("creates the first consent request and enqueues exactly one consent_required notification", async () => {
    const { repo: consentRepo, state } = createFakeConsentRepository();
    const { repo: schedulingRepo, state: schedulingState } = createFakeSchedulingRepository();

    const result = await enqueueConsentRequest(consentRepo, schedulingRepo, { customerId: "customer-1", serviceVisitId: "visit-1" });

    expect(result.enqueued).toBe(true);
    expect(state.consents.size).toBe(1);
    const notices = [...schedulingState.notifications.values()].filter((n) => n.notificationType === "consent_required");
    expect(notices.length).toBe(1);
    expect(notices[0].state).toBe("pending");
    expect(notices[0].serviceVisitId).toBe("visit-1");
  });

  it("works with serviceVisitId=null (a prepaid package before its first visit is scheduled)", async () => {
    const { repo: consentRepo } = createFakeConsentRepository();
    const { repo: schedulingRepo, state: schedulingState } = createFakeSchedulingRepository();

    const result = await enqueueConsentRequest(consentRepo, schedulingRepo, { customerId: "customer-1", serviceVisitId: null });

    expect(result.enqueued).toBe(true);
    const notices = [...schedulingState.notifications.values()].filter((n) => n.notificationType === "consent_required");
    expect(notices[0].serviceVisitId).toBeNull();
  });

  it("an existing request for the active version (signed or otherwise) suppresses another request — never a duplicate", async () => {
    const { repo: consentRepo, state } = createFakeConsentRepository();
    const { repo: schedulingRepo, state: schedulingState } = createFakeSchedulingRepository();

    await enqueueConsentRequest(consentRepo, schedulingRepo, { customerId: "customer-1", serviceVisitId: "visit-1" });
    const second = await enqueueConsentRequest(consentRepo, schedulingRepo, { customerId: "customer-1", serviceVisitId: "visit-2" });

    expect(second.enqueued).toBe(false);
    expect(state.consents.size).toBe(1);
    expect([...schedulingState.notifications.values()].filter((n) => n.notificationType === "consent_required").length).toBe(1);
  });

  it("a NEW active consent version requires a genuinely new consent request", async () => {
    const { repo: consentRepo, state } = createFakeConsentRepository({
      versions: [
        { id: "v1", versionLabel: "CP-CONSENT-2026-01", title: "t", bodyText: "old text", isLegallyReviewed: false, isActive: false },
        { id: "v2", versionLabel: "CP-CONSENT-2026-02", title: "t", bodyText: "new text", isLegallyReviewed: false, isActive: true },
      ],
    });
    const { repo: schedulingRepo } = createFakeSchedulingRepository();

    // Customer already signed v1 (simulated directly on the fake state).
    state.consents.set("customer-1:v1", {
      id: "old-consent",
      customerId: "customer-1",
      consentVersionId: "v1",
      serviceVisitId: null,
      state: "signed",
      sentAt: new Date(),
      viewedAt: new Date(),
      declinedAt: null,
      signedAt: new Date(),
      acceptedTextSnapshot: "old text",
      signedName: "Jane Doe",
      ipAddress: null,
      userAgent: null,
      signedDocumentPath: null,
      signedDocumentSha256: null,
    });

    const result = await enqueueConsentRequest(consentRepo, schedulingRepo, { customerId: "customer-1", serviceVisitId: "visit-1" });

    expect(result.enqueued).toBe(true);
    const v2Record = await consentRepo.findByCustomerAndVersion("customer-1", "v2");
    expect(v2Record?.state).toBe("sent");
  });

  it("no-ops entirely when no consent version is active", async () => {
    const { repo: consentRepo } = createFakeConsentRepository({ versions: [] });
    const { repo: schedulingRepo, state: schedulingState } = createFakeSchedulingRepository();

    const result = await enqueueConsentRequest(consentRepo, schedulingRepo, { customerId: "customer-1", serviceVisitId: "visit-1" });

    expect(result.enqueued).toBe(false);
    expect(schedulingState.notifications.size).toBe(0);
  });
});
