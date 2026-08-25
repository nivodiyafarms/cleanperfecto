import { describe, expect, it } from "vitest";
import { createFakeSchedulingRepository } from "@/lib/scheduling/test-support/fake-scheduling-repository";
import { scheduleConsentReminderIfUnsigned } from "./schedule-consent-reminder";
import { signConsent } from "./sign-consent";
import { createFakeConsentRepository } from "./test-support/fake-consent-repository";

describe("scheduleConsentReminderIfUnsigned", () => {
  it("schedules the reminder at confirmedStartAt - 24h when that's still in the future", async () => {
    const { repo: consentRepo } = createFakeConsentRepository();
    const { repo: schedulingRepo, state } = createFakeSchedulingRepository();
    const confirmedStartAt = new Date("2026-09-10T15:00:00.000Z");
    const now = new Date("2026-09-01T00:00:00.000Z");

    await scheduleConsentReminderIfUnsigned(schedulingRepo, consentRepo, { serviceVisitId: "visit-1", customerId: "customer-1", confirmedStartAt, now });

    const reminder = [...state.notifications.values()].find((n) => n.notificationType === "consent_reminder");
    expect(reminder?.scheduledSendAt.toISOString()).toBe("2026-09-09T15:00:00.000Z");
    expect(reminder?.state).toBe("pending");
  });

  it("becomes immediately eligible (not scheduled into the past) when confirmed less than 24h before service", async () => {
    const { repo: consentRepo } = createFakeConsentRepository();
    const { repo: schedulingRepo, state } = createFakeSchedulingRepository();
    const now = new Date("2026-09-10T10:00:00.000Z");
    const confirmedStartAt = new Date("2026-09-10T15:00:00.000Z"); // only 5 hours away

    await scheduleConsentReminderIfUnsigned(schedulingRepo, consentRepo, { serviceVisitId: "visit-1", customerId: "customer-1", confirmedStartAt, now });

    const reminder = [...state.notifications.values()].find((n) => n.notificationType === "consent_reminder");
    expect(reminder?.scheduledSendAt.getTime()).toBe(now.getTime());
    expect(reminder!.scheduledSendAt.getTime()).toBeGreaterThanOrEqual(now.getTime());
  });

  it("does not schedule a reminder when the customer has already signed the active version", async () => {
    const { repo: consentRepo } = createFakeConsentRepository();
    const { repo: schedulingRepo, state } = createFakeSchedulingRepository();
    await signConsent(consentRepo, schedulingRepo, {
      customerId: "customer-1",
      signedName: "Jane Doe",
      agreedToTerms: true,
      ipAddress: null,
      userAgent: null,
    });

    await scheduleConsentReminderIfUnsigned(schedulingRepo, consentRepo, {
      serviceVisitId: "visit-1",
      customerId: "customer-1",
      confirmedStartAt: new Date("2026-09-10T15:00:00.000Z"),
    });

    expect([...state.notifications.values()].filter((n) => n.notificationType === "consent_reminder").length).toBe(0);
  });

  it("uses confirmedStartAt (not `now`) as the idempotency versionKey, so a retried confirmation of the SAME time never duplicates", async () => {
    const { repo: consentRepo } = createFakeConsentRepository();
    const { repo: schedulingRepo, state } = createFakeSchedulingRepository();
    const confirmedStartAt = new Date("2026-09-10T15:00:00.000Z");

    await scheduleConsentReminderIfUnsigned(schedulingRepo, consentRepo, { serviceVisitId: "visit-1", customerId: "customer-1", confirmedStartAt, now: new Date("2026-09-01T00:00:00Z") });
    await scheduleConsentReminderIfUnsigned(schedulingRepo, consentRepo, { serviceVisitId: "visit-1", customerId: "customer-1", confirmedStartAt, now: new Date("2026-09-01T01:00:00Z") });

    expect([...state.notifications.values()].filter((n) => n.notificationType === "consent_reminder").length).toBe(1);
  });
});
