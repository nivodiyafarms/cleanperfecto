import { describe, expect, it } from "vitest";
import { createFakeSchedulingRepository } from "@/lib/scheduling/test-support/fake-scheduling-repository";
import { InvalidConsentStateError } from "./errors";
import { resendConsentRequest } from "./resend-consent-request";
import { signConsent } from "./sign-consent";
import { createFakeConsentRepository } from "./test-support/fake-consent-repository";

describe("resendConsentRequest", () => {
  it("enqueues a fresh consent_required notification for a customer stuck unsigned", async () => {
    const { repo: consentRepo } = createFakeConsentRepository();
    const { repo: schedulingRepo, state: schedulingState } = createFakeSchedulingRepository();
    await consentRepo.insertSentRequest({ customerId: "customer-1", consentVersionId: "version-1", serviceVisitId: null });

    await resendConsentRequest(consentRepo, schedulingRepo, "customer-1");

    const notices = [...schedulingState.notifications.values()].filter((n) => n.notificationType === "consent_required");
    expect(notices.length).toBe(1);
  });

  it("refuses to resend once the customer has already signed", async () => {
    const { repo: consentRepo } = createFakeConsentRepository();
    const { repo: schedulingRepo } = createFakeSchedulingRepository();
    await signConsent(consentRepo, schedulingRepo, {
      customerId: "customer-1",
      signedName: "Jane Doe",
      agreedToTerms: true,
      ipAddress: null,
      userAgent: null,
    });

    await expect(resendConsentRequest(consentRepo, schedulingRepo, "customer-1")).rejects.toThrow(InvalidConsentStateError);
  });
});
