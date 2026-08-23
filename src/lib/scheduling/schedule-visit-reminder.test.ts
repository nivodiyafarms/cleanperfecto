import { describe, expect, it } from "vitest";
import { cancelPendingReminder, scheduleVisitReminder } from "./schedule-visit-reminder";
import { createFakeSchedulingRepository } from "./test-support/fake-scheduling-repository";

describe("scheduleVisitReminder", () => {
  it("schedules a pending reminder ~24 hours before the confirmed start", async () => {
    const { repo, state } = createFakeSchedulingRepository();
    const confirmedStartAt = new Date("2026-08-30T15:00:00.000Z");
    await scheduleVisitReminder(repo, "visit-1", confirmedStartAt);
    const notification = [...state.notifications.values()][0];
    expect(notification.state).toBe("pending");
  });

  it("does not create a duplicate reminder for the same visit/confirmed time", async () => {
    const { repo, state } = createFakeSchedulingRepository();
    const confirmedStartAt = new Date("2026-08-30T15:00:00.000Z");
    await scheduleVisitReminder(repo, "visit-1", confirmedStartAt);
    await scheduleVisitReminder(repo, "visit-1", confirmedStartAt);
    expect(state.notifications.size).toBe(1);
  });

  it("creates a new reminder (different idempotency key) when the confirmed time changes", async () => {
    const { repo, state } = createFakeSchedulingRepository();
    await scheduleVisitReminder(repo, "visit-1", new Date("2026-08-30T15:00:00.000Z"));
    await scheduleVisitReminder(repo, "visit-1", new Date("2026-08-31T15:00:00.000Z"));
    expect(state.notifications.size).toBe(2);
  });
});

describe("cancelPendingReminder", () => {
  it("cancels only pending reminders for the given visit", async () => {
    const { repo, state } = createFakeSchedulingRepository();
    await scheduleVisitReminder(repo, "visit-1", new Date("2026-08-30T15:00:00.000Z"));
    await scheduleVisitReminder(repo, "visit-2", new Date("2026-08-30T15:00:00.000Z"));

    await cancelPendingReminder(repo, "visit-1");

    const visit1Notifications = [...state.notifications.values()].filter((n) => n.serviceVisitId === "visit-1");
    const visit2Notifications = [...state.notifications.values()].filter((n) => n.serviceVisitId === "visit-2");
    expect(visit1Notifications.every((n) => n.state === "cancelled")).toBe(true);
    expect(visit2Notifications.every((n) => n.state === "pending")).toBe(true);
  });
});
