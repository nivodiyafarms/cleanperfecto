import { describe, expect, it } from "vitest";
import { createFakeConsentRepository } from "@/lib/consent/test-support/fake-consent-repository";
import { confirmServiceVisit } from "./confirm-service-visit";
import { createRequestedVisitFromBooking } from "./create-requested-visit-from-booking";
import { rescheduleServiceVisit } from "./reschedule-service-visit";
import { createFakeSchedulingRepository } from "./test-support/fake-scheduling-repository";

const DURATION_INPUT = { cleaningType: "standard" as const, sizeTier: "2br_2ba" as const, condition: "light" as const };

async function seedScheduledVisit(repo: ReturnType<typeof createFakeSchedulingRepository>["repo"]) {
  const { visitId } = await createRequestedVisitFromBooking(repo, {
    bookingOrderId: "booking-1",
    customerId: "customer-1",
    quoteRequestId: "quote-1",
    cleaningType: "standard",
    frequency: "one_time",
    requestedDate: "2026-08-30",
    requestedStartTime: "10:00",
    serviceAddressLine1: null,
    serviceAddressLine2: null,
    serviceCity: null,
    serviceState: null,
    serviceAddressIdentity: null,
  });
  await confirmServiceVisit(repo, {
    serviceVisitId: visitId,
    date: "2026-08-30",
    startTime: "10:00",
    cleanerIds: ["cleaner-1"],
    durationInput: DURATION_INPUT,
  });
  return visitId;
}

describe("rescheduleServiceVisit", () => {
  it("moves the SAME visit to a new confirmed time (no new visit created)", async () => {
    const { repo, state } = createFakeSchedulingRepository({ cleaners: [{ id: "cleaner-1", name: "A", active: true }] });
    const visitId = await seedScheduledVisit(repo);
    const before = state.serviceVisitsById.get(visitId)?.confirmedStartAt;

    await rescheduleServiceVisit(repo, {
      serviceVisitId: visitId,
      date: "2026-08-31",
      startTime: "12:00",
      cleanerIds: ["cleaner-1"],
      durationInput: DURATION_INPUT,
      now: new Date("2026-08-25T00:00:00Z"), // >48h before original 2026-08-30T10:00 CDT
    });

    expect(state.serviceVisitsById.size).toBe(1);
    const after = state.serviceVisitsById.get(visitId)?.confirmedStartAt;
    expect(after?.getTime()).not.toBe(before?.getTime());
  });

  it("charges no fee with 48+ hours notice", async () => {
    const { repo } = createFakeSchedulingRepository({ cleaners: [{ id: "cleaner-1", name: "A", active: true }] });
    const visitId = await seedScheduledVisit(repo);
    const fee = await rescheduleServiceVisit(repo, {
      serviceVisitId: visitId,
      date: "2026-08-31",
      startTime: "12:00",
      cleanerIds: ["cleaner-1"],
      durationInput: DURATION_INPUT,
      now: new Date("2026-08-25T00:00:00Z"),
    });
    expect(fee).toBeNull();
  });

  it("charges the $25 late-change fee for 24-48 hours notice", async () => {
    const { repo } = createFakeSchedulingRepository({ cleaners: [{ id: "cleaner-1", name: "A", active: true }] });
    const visitId = await seedScheduledVisit(repo);
    const originalConfirmedStartAt = new Date("2026-08-30T15:00:00.000Z"); // 10:00 CDT
    const now = new Date(originalConfirmedStartAt.getTime() - 30 * 60 * 60 * 1000);
    const fee = await rescheduleServiceVisit(repo, {
      serviceVisitId: visitId,
      date: "2026-09-02",
      startTime: "12:00",
      cleanerIds: ["cleaner-1"],
      durationInput: DURATION_INPUT,
      now,
    });
    expect(fee?.amount).toBe(25);
  });

  it("charges the $50 same-day fee for under 24 hours notice", async () => {
    const { repo } = createFakeSchedulingRepository({ cleaners: [{ id: "cleaner-1", name: "A", active: true }] });
    const visitId = await seedScheduledVisit(repo);
    const originalConfirmedStartAt = new Date("2026-08-30T15:00:00.000Z");
    const now = new Date(originalConfirmedStartAt.getTime() - 5 * 60 * 60 * 1000);
    const fee = await rescheduleServiceVisit(repo, {
      serviceVisitId: visitId,
      date: "2026-09-02",
      startTime: "12:00",
      cleanerIds: ["cleaner-1"],
      durationInput: DURATION_INPUT,
      now,
    });
    expect(fee?.amount).toBe(50);
  });

  it("replaces the stale pending reminder with a fresh one for the new time", async () => {
    const { repo, state } = createFakeSchedulingRepository({ cleaners: [{ id: "cleaner-1", name: "A", active: true }] });
    const visitId = await seedScheduledVisit(repo);
    const reminderBefore = [...state.notifications.values()].filter(
      (n) => n.serviceVisitId === visitId && n.notificationType === "reminder_24h" && n.state === "pending"
    );
    expect(reminderBefore.length).toBe(1);

    await rescheduleServiceVisit(repo, {
      serviceVisitId: visitId,
      date: "2026-08-31",
      startTime: "12:00",
      cleanerIds: ["cleaner-1"],
      durationInput: DURATION_INPUT,
      now: new Date("2026-08-25T00:00:00Z"),
    });

    const remindersForVisit = [...state.notifications.values()].filter((n) => n.serviceVisitId === visitId && n.notificationType === "reminder_24h");
    const pendingReminders = remindersForVisit.filter((n) => n.state === "pending");
    const cancelledReminders = remindersForVisit.filter((n) => n.state === "cancelled");
    expect(pendingReminders.length).toBe(1);
    expect(cancelledReminders.length).toBe(1);
  });

  it("enqueues exactly one pending rescheduled notice", async () => {
    const { repo, state } = createFakeSchedulingRepository({ cleaners: [{ id: "cleaner-1", name: "A", active: true }] });
    const visitId = await seedScheduledVisit(repo);

    await rescheduleServiceVisit(repo, {
      serviceVisitId: visitId,
      date: "2026-08-31",
      startTime: "12:00",
      cleanerIds: ["cleaner-1"],
      durationInput: DURATION_INPUT,
      now: new Date("2026-08-25T00:00:00Z"),
    });

    const rescheduledNotices = [...state.notifications.values()].filter((n) => n.serviceVisitId === visitId && n.notificationType === "rescheduled");
    expect(rescheduledNotices.length).toBe(1);
    expect(rescheduledNotices[0].state).toBe("pending");
  });

  it("cancels the old pending consent_reminder and enqueues a new one only if consent remains unsigned", async () => {
    const { repo, state } = createFakeSchedulingRepository({ cleaners: [{ id: "cleaner-1", name: "A", active: true }] });
    const { repo: consentRepo } = createFakeConsentRepository();
    const { visitId } = await createRequestedVisitFromBooking(repo, {
      bookingOrderId: "booking-1",
      customerId: "customer-1",
      quoteRequestId: "quote-1",
      cleaningType: "standard",
      frequency: "one_time",
      requestedDate: "2026-08-30",
      requestedStartTime: "10:00",
      serviceAddressLine1: null,
      serviceAddressLine2: null,
      serviceCity: null,
      serviceState: null,
      serviceAddressIdentity: null,
    });
    await confirmServiceVisit(repo, { serviceVisitId: visitId, date: "2026-08-30", startTime: "10:00", cleanerIds: ["cleaner-1"], durationInput: DURATION_INPUT, consentRepo });

    const beforeReminders = [...state.notifications.values()].filter((n) => n.serviceVisitId === visitId && n.notificationType === "consent_reminder");
    expect(beforeReminders.length).toBe(1);
    expect(beforeReminders[0].state).toBe("pending");

    await rescheduleServiceVisit(repo, {
      serviceVisitId: visitId,
      date: "2026-09-02",
      startTime: "12:00",
      cleanerIds: ["cleaner-1"],
      durationInput: DURATION_INPUT,
      now: new Date("2026-08-25T00:00:00Z"),
      consentRepo,
    });

    const allReminders = [...state.notifications.values()].filter((n) => n.serviceVisitId === visitId && n.notificationType === "consent_reminder");
    expect(allReminders.filter((n) => n.state === "cancelled").length).toBe(1);
    expect(allReminders.filter((n) => n.state === "pending").length).toBe(1);
  });

  it("does not re-enqueue a consent_reminder on reschedule once the customer has already signed", async () => {
    const { repo, state } = createFakeSchedulingRepository({ cleaners: [{ id: "cleaner-1", name: "A", active: true }] });
    const { repo: consentRepo } = createFakeConsentRepository();
    const { visitId } = await createRequestedVisitFromBooking(repo, {
      bookingOrderId: "booking-1",
      customerId: "customer-1",
      quoteRequestId: "quote-1",
      cleaningType: "standard",
      frequency: "one_time",
      requestedDate: "2026-08-30",
      requestedStartTime: "10:00",
      serviceAddressLine1: null,
      serviceAddressLine2: null,
      serviceCity: null,
      serviceState: null,
      serviceAddressIdentity: null,
    });
    await confirmServiceVisit(repo, { serviceVisitId: visitId, date: "2026-08-30", startTime: "10:00", cleanerIds: ["cleaner-1"], durationInput: DURATION_INPUT, consentRepo });
    await consentRepo.sign((await consentRepo.insertSentRequest({ customerId: "customer-1", consentVersionId: "version-1", serviceVisitId: null })).record.id, {
      signedName: "Jane Doe",
      acceptedTextSnapshot: "text",
      ipAddress: null,
      userAgent: null,
    });

    await rescheduleServiceVisit(repo, {
      serviceVisitId: visitId,
      date: "2026-09-02",
      startTime: "12:00",
      cleanerIds: ["cleaner-1"],
      durationInput: DURATION_INPUT,
      now: new Date("2026-08-25T00:00:00Z"),
      consentRepo,
    });

    const pendingReminders = [...state.notifications.values()].filter(
      (n) => n.serviceVisitId === visitId && n.notificationType === "consent_reminder" && n.state === "pending"
    );
    expect(pendingReminders.length).toBe(0);
  });
});
