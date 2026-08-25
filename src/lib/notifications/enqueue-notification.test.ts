import { describe, expect, it } from "vitest";
import { createFakeSchedulingRepository } from "@/lib/scheduling/test-support/fake-scheduling-repository";
import { enqueueNotification } from "./enqueue-notification";

describe("enqueueNotification", () => {
  it("inserts a pending row with a deterministic idempotency key", async () => {
    const { repo, state } = createFakeSchedulingRepository();
    const scheduledSendAt = new Date("2026-09-01T10:00:00Z");

    const result = await enqueueNotification(repo, {
      serviceVisitId: "visit-1",
      customerId: "customer-1",
      notificationType: "appointment_confirmed",
      channel: "email",
      scheduledSendAt,
      versionKey: "2026-09-01T10:00:00.000Z",
    });

    expect(result.inserted).toBe(true);
    const notification = [...state.notifications.values()][0];
    expect(notification.idempotencyKey).toBe("customer-1:visit-1:appointment_confirmed:email:2026-09-01T10:00:00.000Z");
    expect(notification.state).toBe("pending");
    expect(notification.customerId).toBe("customer-1");
  });

  it("uses customerId (not just serviceVisitId) in the key, so two customers' null-serviceVisitId requests never collide", async () => {
    const { repo, state } = createFakeSchedulingRepository();
    await enqueueNotification(repo, {
      serviceVisitId: null,
      customerId: "customer-a",
      notificationType: "consent_required",
      channel: "email",
      scheduledSendAt: new Date(),
      versionKey: "version-1",
    });
    await enqueueNotification(repo, {
      serviceVisitId: null,
      customerId: "customer-b",
      notificationType: "consent_required",
      channel: "email",
      scheduledSendAt: new Date(),
      versionKey: "version-1",
    });

    expect(state.notifications.size).toBe(2);
  });

  it("is idempotent — a repeated call with the same inputs never creates a duplicate row", async () => {
    const { repo, state } = createFakeSchedulingRepository();
    const input = {
      serviceVisitId: "visit-1",
      customerId: "customer-1",
      notificationType: "cancelled" as const,
      channel: "email" as const,
      scheduledSendAt: new Date(),
      versionKey: "v1",
    };

    const first = await enqueueNotification(repo, input);
    const second = await enqueueNotification(repo, input);

    expect(first.inserted).toBe(true);
    expect(second.inserted).toBe(false);
    expect(state.notifications.size).toBe(1);
  });

  it("a different versionKey mints a genuinely new row (never collides with a prior logical notification)", async () => {
    const { repo, state } = createFakeSchedulingRepository();
    await enqueueNotification(repo, {
      serviceVisitId: "visit-1",
      customerId: "customer-1",
      notificationType: "pricing_approval_required",
      channel: "email",
      scheduledSendAt: new Date(),
      versionKey: "150.00",
    });
    await enqueueNotification(repo, {
      serviceVisitId: "visit-1",
      customerId: "customer-1",
      notificationType: "pricing_approval_required",
      channel: "email",
      scheduledSendAt: new Date(),
      versionKey: "175.00",
    });

    expect(state.notifications.size).toBe(2);
  });
});
