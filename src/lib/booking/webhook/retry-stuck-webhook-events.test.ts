import { describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";
import { createFakeBookingRepository } from "../test-support/fake-booking-repository";
import { createFakeSchedulingRepository } from "@/lib/scheduling/test-support/fake-scheduling-repository";
import { createFakeVisitPaymentGateway } from "@/lib/payments/test-support/fake-visit-payment-gateway";
import { prepareVisitPaymentReview } from "@/lib/payments/prepare-visit-payment-review";
import { selectVisitTip } from "@/lib/payments/select-visit-tip";
import { createVisitPaymentIntent } from "@/lib/payments/create-visit-payment-intent";
import { claimWebhookEvent } from "./claim-webhook-event";
import { retryStuckWebhookEvents, WEBHOOK_PROCESSING_LEASE_SECONDS } from "./retry-stuck-webhook-events";
import type { NewServiceVisitRow } from "@/lib/scheduling/domain-types";

function fakeStripe(): Stripe {
  return {
    paymentIntents: { retrieve: vi.fn(async () => ({ status: "succeeded" })) },
  } as unknown as Stripe;
}

function paymentIntentEvent(id: string, intentId: string): Stripe.Event {
  return { id, type: "payment_intent.succeeded", livemode: false, data: { object: { id: intentId } as Stripe.PaymentIntent } } as unknown as Stripe.Event;
}

const NEW_VISIT: NewServiceVisitRow = {
  customerId: "customer-1",
  quoteRequestId: null,
  bookingOrderId: null,
  prepaidPackageId: null,
  recurringScheduleId: null,
  visitNumber: null,
  cleaningType: "standard",
  frequency: "one_time",
  requestedStartAt: new Date(),
  timezone: "America/Chicago",
  serviceAddressLine1: "123 Main St",
  serviceAddressLine2: null,
  serviceCity: "Frisco",
  serviceState: "TX",
  serviceAddressIdentity: "75056|123 MAIN ST|",
};

async function seedChargedVisit(bookingRepo: ReturnType<typeof createFakeBookingRepository>["repo"]) {
  const { repo: schedulingRepo, state } = createFakeSchedulingRepository();
  const visit = await schedulingRepo.insertServiceVisit(NEW_VISIT);
  await schedulingRepo.upsertServiceVisitPricing({
    serviceVisitId: visit.id,
    pricingVersion: "v1",
    pricingSnapshot: {},
    baseAmount: 179,
    addOnIds: [],
    addOnAmount: 0,
    totalAmount: 179,
    amountDueFromCustomer: 179,
    priceStatus: "estimated",
    requiresCustomerApproval: false,
    previouslyApprovedAmount: null,
  });
  await schedulingRepo.confirmServiceVisitPricing(visit.id, "admin:1");
  state.serviceVisitsById.set(visit.id, { ...(await schedulingRepo.findServiceVisitById(visit.id))!, status: "completed" });

  const { gateway } = createFakeVisitPaymentGateway();
  await prepareVisitPaymentReview(schedulingRepo, gateway, visit.id);
  await selectVisitTip(schedulingRepo, gateway, { serviceVisitId: visit.id, tipSelectionType: "percentage_15" });

  const outcome = await createVisitPaymentIntent(schedulingRepo, bookingRepo, gateway, { serviceVisitId: visit.id, customerId: "customer-1" });
  if (outcome.outcome !== "ready") throw new Error("expected ready");

  const payment = (await schedulingRepo.findServiceVisitPaymentByVisitId(visit.id))!;
  return { schedulingRepo, gateway, paymentIntentId: payment.stripePaymentIntentId! };
}

describe("retryStuckWebhookEvents", () => {
  it("reprocesses a 'failed' event from its own stored payload and marks it processed", async () => {
    const { repo: bookingRepo, state } = createFakeBookingRepository({
      customers: { "customer-1": { id: "customer-1", name: "Jane", email: "jane@example.com", phone: null, stripeCustomerId: "cus_1", stripeDefaultPaymentMethodId: "pm_1", stripePaymentMethodBrand: "visa", stripePaymentMethodLast4: "4242" } },
    });
    const { schedulingRepo, gateway, paymentIntentId } = await seedChargedVisit(bookingRepo);
    const event = paymentIntentEvent("evt_stuck_failed", paymentIntentId);

    const claim = await claimWebhookEvent(bookingRepo, event.id, event.type, event as unknown as Record<string, unknown>);
    await bookingRepo.markWebhookEventFailed(claim.eventRowId, "simulated crash mid-processing", claim.claimToken);

    const result = await retryStuckWebhookEvents(fakeStripe(), bookingRepo, schedulingRepo, undefined, gateway, new Date(), 20, "stripe_sandbox");

    expect(result).toEqual({ attempted: 1, processed: 1, skipped: 0, failed: 0 });
    expect(state.webhookEventsByStripeId.get("evt_stuck_failed")?.processingStatus).toBe("processed");
    const payment = await schedulingRepo.findServiceVisitPaymentByStripePaymentIntentId(paymentIntentId);
    expect(payment?.status).toBe("paid");
  });

  it("a 'processing' row still within its lease is left alone — a live delivery may genuinely still be working it", async () => {
    const { repo: bookingRepo, state } = createFakeBookingRepository();
    const event = paymentIntentEvent("evt_still_active", "pi_unrelated");
    await claimWebhookEvent(bookingRepo, event.id, event.type, event as unknown as Record<string, unknown>);

    const result = await retryStuckWebhookEvents(fakeStripe(), bookingRepo, undefined, undefined, undefined, new Date(), 20, "stripe_sandbox");

    expect(result).toEqual({ attempted: 0, processed: 0, skipped: 0, failed: 0 });
    expect(state.webhookEventsByStripeId.get("evt_still_active")?.processingStatus).toBe("processing");
  });

  it("a 'processing' row past its lease is reclaimed and completed — the lease alone doesn't finish the job, this sweep does", async () => {
    const { repo: bookingRepo, state } = createFakeBookingRepository({
      customers: { "customer-1": { id: "customer-1", name: "Jane", email: "jane@example.com", phone: null, stripeCustomerId: "cus_1", stripeDefaultPaymentMethodId: "pm_1", stripePaymentMethodBrand: "visa", stripePaymentMethodLast4: "4242" } },
    });
    const { schedulingRepo, gateway, paymentIntentId } = await seedChargedVisit(bookingRepo);
    const event = paymentIntentEvent("evt_stuck_processing", paymentIntentId);

    await claimWebhookEvent(bookingRepo, event.id, event.type, event as unknown as Record<string, unknown>);
    // Simulate a worker that claimed it and then crashed/was killed —
    // never called markWebhookEventProcessed/Failed.
    const row = state.webhookEventsByStripeId.get("evt_stuck_processing")!;
    row.processingClaimedAt = new Date(Date.now() - (WEBHOOK_PROCESSING_LEASE_SECONDS + 60) * 1000);

    const result = await retryStuckWebhookEvents(fakeStripe(), bookingRepo, schedulingRepo, undefined, gateway, new Date(), 20, "stripe_sandbox");

    expect(result).toEqual({ attempted: 1, processed: 1, skipped: 0, failed: 0 });
    expect(state.webhookEventsByStripeId.get("evt_stuck_processing")?.processingStatus).toBe("processed");
  });

  it("running the sweep twice in a row never double-processes — the second pass finds nothing left to do", async () => {
    const { repo: bookingRepo, state } = createFakeBookingRepository({
      customers: { "customer-1": { id: "customer-1", name: "Jane", email: "jane@example.com", phone: null, stripeCustomerId: "cus_1", stripeDefaultPaymentMethodId: "pm_1", stripePaymentMethodBrand: "visa", stripePaymentMethodLast4: "4242" } },
    });
    const { schedulingRepo, gateway, paymentIntentId } = await seedChargedVisit(bookingRepo);
    const event = paymentIntentEvent("evt_stuck_twice", paymentIntentId);

    const claim = await claimWebhookEvent(bookingRepo, event.id, event.type, event as unknown as Record<string, unknown>);
    await bookingRepo.markWebhookEventFailed(claim.eventRowId, "simulated crash", claim.claimToken);

    const first = await retryStuckWebhookEvents(fakeStripe(), bookingRepo, schedulingRepo, undefined, gateway, new Date(), 20, "stripe_sandbox");
    const second = await retryStuckWebhookEvents(fakeStripe(), bookingRepo, schedulingRepo, undefined, gateway, new Date(), 20, "stripe_sandbox");

    expect(first.processed).toBe(1);
    expect(second).toEqual({ attempted: 0, processed: 0, skipped: 0, failed: 0 });
    expect(state.webhookEventsByStripeId.get("evt_stuck_twice")?.processingStatus).toBe("processed");
  });
});
