import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFakeSchedulingRepository } from "@/lib/scheduling/test-support/fake-scheduling-repository";
import { enqueueReviewRequest } from "./enqueue-review-request";

function baseInput(overrides: Partial<Parameters<typeof enqueueReviewRequest>[1]> = {}) {
  return {
    serviceVisitId: "visit-1",
    customerId: "customer-1",
    completedAtUtc: new Date("2026-09-10T15:00:00.000Z"),
    timezone: "America/Chicago",
    reviewRequestSuppressed: false,
    ...overrides,
  };
}

describe("enqueueReviewRequest", () => {
  beforeEach(() => {
    process.env.GOOGLE_REVIEW_URL = "https://example.com/leave-a-review";
  });
  afterEach(() => {
    delete process.env.GOOGLE_REVIEW_URL;
  });

  it("enqueues exactly one review_request notification", async () => {
    const { repo, state } = createFakeSchedulingRepository();
    const outcome = await enqueueReviewRequest(repo, baseInput());
    expect(outcome).toEqual({ enqueued: true });
    const notices = [...state.notifications.values()].filter((n) => n.notificationType === "review_request");
    expect(notices.length).toBe(1);
  });

  it("skips when the visit's review_request_suppressed flag is true", async () => {
    const { repo, state } = createFakeSchedulingRepository();
    const outcome = await enqueueReviewRequest(repo, baseInput({ reviewRequestSuppressed: true }));
    expect(outcome).toEqual({ enqueued: false, reason: "suppressed" });
    expect(state.notifications.size).toBe(0);
  });

  it("skips when GOOGLE_REVIEW_URL is not configured — never enqueues a broken/missing link", async () => {
    delete process.env.GOOGLE_REVIEW_URL;
    const { repo, state } = createFakeSchedulingRepository();
    const outcome = await enqueueReviewRequest(repo, baseInput());
    expect(outcome).toEqual({ enqueued: false, reason: "google_review_url_not_configured" });
    expect(state.notifications.size).toBe(0);
  });

  it("skips when a SENT review_request exists within the 180-day cooldown", async () => {
    const { repo, state } = createFakeSchedulingRepository();
    await repo.insertServiceVisitNotification({
      serviceVisitId: "visit-0",
      customerId: "customer-1",
      notificationType: "review_request",
      channel: "email",
      scheduledSendAt: new Date(),
      idempotencyKey: "customer-1:visit-0:review_request:email:v1",
    });
    const notification = [...state.notifications.values()][0];
    notification.state = "sent";
    notification.sentAt = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 30 days ago

    const outcome = await enqueueReviewRequest(repo, baseInput({ serviceVisitId: "visit-1" }));

    expect(outcome).toEqual({ enqueued: false, reason: "cooldown_active" });
  });

  it("allows a new review_request once the 180-day cooldown has elapsed", async () => {
    const { repo, state } = createFakeSchedulingRepository();
    await repo.insertServiceVisitNotification({
      serviceVisitId: "visit-0",
      customerId: "customer-1",
      notificationType: "review_request",
      channel: "email",
      scheduledSendAt: new Date(),
      idempotencyKey: "customer-1:visit-0:review_request:email:v1",
    });
    const notification = [...state.notifications.values()][0];
    notification.state = "sent";
    notification.sentAt = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000); // 200 days ago

    const outcome = await enqueueReviewRequest(repo, baseInput({ serviceVisitId: "visit-1" }));

    expect(outcome).toEqual({ enqueued: true });
  });

  it("a merely queued (pending) prior review_request does NOT start the cooldown", async () => {
    const { repo, state } = createFakeSchedulingRepository();
    await repo.insertServiceVisitNotification({
      serviceVisitId: "visit-0",
      customerId: "customer-1",
      notificationType: "review_request",
      channel: "email",
      scheduledSendAt: new Date(),
      idempotencyKey: "customer-1:visit-0:review_request:email:v1",
    });
    // Deliberately left in 'pending' — never marked sent.
    expect(state.notifications.size).toBe(1);

    const outcome = await enqueueReviewRequest(repo, baseInput({ serviceVisitId: "visit-1" }));

    expect(outcome).toEqual({ enqueued: true });
  });

  it("a failed prior review_request does NOT start the cooldown", async () => {
    const { repo, state } = createFakeSchedulingRepository();
    await repo.insertServiceVisitNotification({
      serviceVisitId: "visit-0",
      customerId: "customer-1",
      notificationType: "review_request",
      channel: "email",
      scheduledSendAt: new Date(),
      idempotencyKey: "customer-1:visit-0:review_request:email:v1",
    });
    const notification = [...state.notifications.values()][0];
    notification.state = "failed";

    const outcome = await enqueueReviewRequest(repo, baseInput({ serviceVisitId: "visit-1" }));

    expect(outcome).toEqual({ enqueued: true });
  });
});
