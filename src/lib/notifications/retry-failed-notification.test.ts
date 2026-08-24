import { describe, expect, it } from "vitest";
import { InvalidVisitStateError } from "@/lib/scheduling/errors";
import { createFakeSchedulingRepository } from "@/lib/scheduling/test-support/fake-scheduling-repository";
import { enqueueNotification } from "./enqueue-notification";
import { retryFailedNotification } from "./retry-failed-notification";

describe("retryFailedNotification", () => {
  it("resets a terminal-failed row to pending with a fresh attempt budget", async () => {
    const { repo, state } = createFakeSchedulingRepository();
    await enqueueNotification(repo, {
      serviceVisitId: "visit-1",
      customerId: "customer-1",
      notificationType: "cancelled",
      channel: "email",
      scheduledSendAt: new Date(),
      versionKey: "v1",
    });
    const notification = [...state.notifications.values()][0];
    notification.state = "failed";
    notification.retryCount = 5;
    notification.failureReason = "provider down";

    await retryFailedNotification(repo, notification.id);

    expect(notification.state).toBe("pending");
    expect(notification.retryCount).toBe(0);
  });

  it("refuses to retry a notification that is not currently failed", async () => {
    const { repo, state } = createFakeSchedulingRepository();
    await enqueueNotification(repo, {
      serviceVisitId: "visit-1",
      customerId: "customer-1",
      notificationType: "cancelled",
      channel: "email",
      scheduledSendAt: new Date(),
      versionKey: "v1",
    });
    const notification = [...state.notifications.values()][0];
    expect(notification.state).toBe("pending");

    await expect(retryFailedNotification(repo, notification.id)).rejects.toThrow(InvalidVisitStateError);
  });

  it("refuses to retry a notification that does not exist", async () => {
    const { repo } = createFakeSchedulingRepository();
    await expect(retryFailedNotification(repo, "does-not-exist")).rejects.toThrow(InvalidVisitStateError);
  });
});
