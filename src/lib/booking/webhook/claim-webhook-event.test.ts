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
    await repo.markWebhookEventProcessed(first.eventRowId);

    const redelivered = await claimWebhookEvent(repo, "evt_2", "checkout.session.completed", {});
    expect(redelivered.shouldProcess).toBe(false);
    expect(redelivered.eventRowId).toBe(first.eventRowId);
  });

  it("a 'failed' row (interrupted processing) is reprocessed on redelivery, never skipped", async () => {
    const { repo } = createFakeBookingRepository();
    const first = await claimWebhookEvent(repo, "evt_3", "checkout.session.completed", {});
    await repo.markWebhookEventFailed(first.eventRowId, "simulated crash");

    const redelivered = await claimWebhookEvent(repo, "evt_3", "checkout.session.completed", {});
    expect(redelivered.shouldProcess).toBe(true);
  });

  it("a 'received' row that never finished processing (crash before fulfillment) is reprocessed, not skipped", async () => {
    const { repo, state } = createFakeBookingRepository();
    const first = await claimWebhookEvent(repo, "evt_4", "checkout.session.completed", {});
    // Simulate: the process crashed right after claiming but before
    // calling markWebhookEventProcessed/Failed — the row is still
    // whatever non-'processed' status claimWebhookEvent left it in.
    expect(state.webhookEventsByStripeId.get("evt_4")?.processingStatus).not.toBe("processed");

    const redelivered = await claimWebhookEvent(repo, "evt_4", "checkout.session.completed", {});
    expect(redelivered.shouldProcess).toBe(true);
    expect(redelivered.eventRowId).toBe(first.eventRowId);
  });
});
