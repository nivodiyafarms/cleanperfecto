import { describe, expect, it } from "vitest";
import { createFakeBookingRepository } from "../test-support/fake-booking-repository";
import { claimWebhookEvent } from "./claim-webhook-event";

describe("claimWebhookEvent", () => {
  it("a first-time event id should be processed", async () => {
    const { repo } = createFakeBookingRepository();
    const claim = await claimWebhookEvent(repo, "evt_1", "checkout.session.completed", {});
    expect(claim.shouldProcess).toBe(true);
  });

  it("a 'processed' row is a true, safe no-op on redelivery", async () => {
    const { repo } = createFakeBookingRepository();
    const first = await claimWebhookEvent(repo, "evt_2", "checkout.session.completed", {});
    await repo.markWebhookEventProcessed(first.eventRowId, first.claimToken);

    const redelivered = await claimWebhookEvent(repo, "evt_2", "checkout.session.completed", {});
    expect(redelivered.shouldProcess).toBe(false);
    expect(redelivered.eventRowId).toBe(first.eventRowId);
  });

  it("a 'failed' row (interrupted processing) is reprocessed on redelivery, never skipped", async () => {
    const { repo } = createFakeBookingRepository();
    const first = await claimWebhookEvent(repo, "evt_3", "checkout.session.completed", {});
    await repo.markWebhookEventFailed(first.eventRowId, "simulated crash", first.claimToken);

    const redelivered = await claimWebhookEvent(repo, "evt_3", "checkout.session.completed", {});
    expect(redelivered.shouldProcess).toBe(true);
  });

  it("concurrent duplicate delivery: a second claim attempt while the first is still within its processing lease is refused, not reprocessed", async () => {
    const { repo } = createFakeBookingRepository();
    // Two deliveries of the same event id arrive close together — the
    // first claims it; the second must not also proceed, even though the
    // first hasn't reached 'processed' or 'failed' yet. This is the exact
    // race the previous read-then-write claim allowed: both would have
    // read a non-'processed' status and both would have run fulfillment.
    const first = await claimWebhookEvent(repo, "evt_concurrent", "payment_intent.succeeded", {});
    expect(first.shouldProcess).toBe(true);

    const second = await claimWebhookEvent(repo, "evt_concurrent", "payment_intent.succeeded", {});
    expect(second.shouldProcess).toBe(false);
    expect(second.eventRowId).toBe(first.eventRowId);
  });

  it("recovery from interrupted processing: a 'processing' row past its lease is reclaimed with a fresh token, never permanently stranded", async () => {
    const { repo, state } = createFakeBookingRepository();
    const first = await claimWebhookEvent(repo, "evt_crashed", "payment_intent.succeeded", {});
    expect(first.shouldProcess).toBe(true);

    // Simulate a worker that claimed the event and then crashed/was killed
    // before ever calling markWebhookEventProcessed/Failed — backdate the
    // lease past expiry, exactly like a stuck row found by a later retry.
    const row = state.webhookEventsByStripeId.get("evt_crashed")!;
    row.processingClaimedAt = new Date(Date.now() - 10 * 60_000);

    const redelivered = await claimWebhookEvent(repo, "evt_crashed", "payment_intent.succeeded", {});
    expect(redelivered.shouldProcess).toBe(true);
    expect(redelivered.eventRowId).toBe(first.eventRowId);
    expect(redelivered.claimToken).not.toBe(first.claimToken);
  });

  it("a stale worker superseded by a later reclaim cannot clobber the reclaimer's outcome", async () => {
    const { repo, state } = createFakeBookingRepository();
    const first = await claimWebhookEvent(repo, "evt_superseded", "payment_intent.succeeded", {});

    const row = state.webhookEventsByStripeId.get("evt_superseded")!;
    row.processingClaimedAt = new Date(Date.now() - 10 * 60_000);
    const reclaimed = await claimWebhookEvent(repo, "evt_superseded", "payment_intent.succeeded", {});
    expect(reclaimed.shouldProcess).toBe(true);

    // The reclaimer finishes successfully first.
    await repo.markWebhookEventProcessed(reclaimed.eventRowId, reclaimed.claimToken);
    expect(state.webhookEventsByStripeId.get("evt_superseded")?.processingStatus).toBe("processed");

    // The original (stale) worker finally wakes up and reports its own
    // outcome using its now-superseded token — this must be a no-op, not a
    // regression of the already-successful reclaimer's result.
    await repo.markWebhookEventFailed(first.eventRowId, "zombie worker timeout", first.claimToken);
    expect(state.webhookEventsByStripeId.get("evt_superseded")?.processingStatus).toBe("processed");
  });
});
