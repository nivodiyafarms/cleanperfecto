import { describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";
import { createFakeSchedulingRepository } from "@/lib/scheduling/test-support/fake-scheduling-repository";
import { createFakeBookingRepository } from "../test-support/fake-booking-repository";
import type { NewBookingOrderRow } from "../types";
import { processStripeWebhookEvent } from "./process-stripe-webhook-event";

// Additive coverage for the Scheduling + Package Management integration
// point in handleSetupSessionCompleted — deliberately a NEW file, not an
// edit to process-stripe-webhook-event.test.ts, so every existing webhook
// test there stays untouched and green.

function fakeStripe(): Stripe {
  return {
    setupIntents: { retrieve: vi.fn(async () => ({ status: "succeeded" })) },
    paymentIntents: { retrieve: vi.fn(async () => ({ status: "succeeded" })) },
  } as unknown as Stripe;
}

function normalBookingOrderInput(overrides: Partial<NewBookingOrderRow> = {}): NewBookingOrderRow {
  return {
    customerId: "customer_1",
    quoteRequestId: "quote_1",
    clientRequestId: `client_req_${Math.random()}`,
    bookingType: "normal",
    cleaningType: "standard",
    frequency: "one_time",
    visitCount: 1,
    paymentAuthorizationAcceptedAt: new Date().toISOString(),
    pricingVersion: "test-version",
    pricingSnapshot: { input: {} as never, result: {} as never },
    calculatedTotal: 150,
    displayRangeLower: 150,
    displayRangeUpper: 160,
    prepaidPackageTotal: null,
    effectivePricePerVisit: null,
    hasStartingAtPricing: false,
    manualReviewReasons: [],
    selectedAddOnIds: [],
    serviceAddressLine1: "123 Main St",
    serviceAddressLine2: null,
    serviceCity: "Frisco",
    serviceState: "TX",
    serviceAddressIdentity: "75056|123 main st|",
    requestedDate: "2026-10-01",
    requestedTimeWindow: null,
    requestedStartTime: "09:00",
    cancellationPolicyVersion: "2026-08-19b",
    ...overrides,
  };
}

function setupSessionEvent(session: Partial<Stripe.Checkout.Session> & { id: string }): Stripe.Event {
  return { id: `evt_${session.id}`, type: "checkout.session.completed", data: { object: session as Stripe.Checkout.Session } } as unknown as Stripe.Event;
}

describe("processStripeWebhookEvent — scheduling integration (setup mode)", () => {
  it("creates an initial 'requested' service_visit once setup succeeds, when a schedulingRepo is supplied", async () => {
    const { repo } = createFakeBookingRepository();
    const bookingOrder = await repo.insertBookingOrder(normalBookingOrderInput());
    await repo.updateBookingOrderStatus(bookingOrder.id, "draft", "awaiting_payment_method");

    const { repo: schedulingRepo, state: schedulingState } = createFakeSchedulingRepository();

    await processStripeWebhookEvent(
      fakeStripe(),
      repo,
      setupSessionEvent({ id: "cs_setup_1", mode: "setup", setup_intent: "seti_1", metadata: { booking_order_id: bookingOrder.id } }),
      schedulingRepo
    );

    expect(schedulingState.serviceVisitsById.size).toBe(1);
    const visit = [...schedulingState.serviceVisitsById.values()][0];
    expect(visit.status).toBe("requested");
    expect(visit.bookingOrderId).toBe(bookingOrder.id);
  });

  it("still transitions booking_orders to pending_confirmation when a schedulingRepo is supplied", async () => {
    const { repo } = createFakeBookingRepository();
    const bookingOrder = await repo.insertBookingOrder(normalBookingOrderInput());
    await repo.updateBookingOrderStatus(bookingOrder.id, "draft", "awaiting_payment_method");

    const { repo: schedulingRepo } = createFakeSchedulingRepository();

    await processStripeWebhookEvent(
      fakeStripe(),
      repo,
      setupSessionEvent({ id: "cs_setup_2", mode: "setup", setup_intent: "seti_2", metadata: { booking_order_id: bookingOrder.id } }),
      schedulingRepo
    );

    expect((await repo.findBookingOrderById(bookingOrder.id))?.status).toBe("pending_confirmation");
  });

  it("is backward compatible — omitting schedulingRepo entirely still processes the booking-order transition (existing callers unaffected)", async () => {
    const { repo } = createFakeBookingRepository();
    const bookingOrder = await repo.insertBookingOrder(normalBookingOrderInput());
    await repo.updateBookingOrderStatus(bookingOrder.id, "draft", "awaiting_payment_method");

    await processStripeWebhookEvent(
      fakeStripe(),
      repo,
      setupSessionEvent({ id: "cs_setup_3", mode: "setup", setup_intent: "seti_3", metadata: { booking_order_id: bookingOrder.id } })
    );

    expect((await repo.findBookingOrderById(bookingOrder.id))?.status).toBe("pending_confirmation");
  });

  it("does not create a duplicate visit if the webhook event is reprocessed (idempotent retry)", async () => {
    const { repo } = createFakeBookingRepository();
    const bookingOrder = await repo.insertBookingOrder(normalBookingOrderInput());
    await repo.updateBookingOrderStatus(bookingOrder.id, "draft", "awaiting_payment_method");
    const { repo: schedulingRepo, state: schedulingState } = createFakeSchedulingRepository();

    const event = setupSessionEvent({ id: "cs_setup_4", mode: "setup", setup_intent: "seti_4", metadata: { booking_order_id: bookingOrder.id } });
    await processStripeWebhookEvent(fakeStripe(), repo, event, schedulingRepo);
    // Simulate Stripe redelivering the same event (e.g. this handler's own
    // retry path, independent of the outer claimWebhookEvent ledger).
    await processStripeWebhookEvent(fakeStripe(), repo, event, schedulingRepo);

    expect(schedulingState.serviceVisitsById.size).toBe(1);
  });

  it("does not create a scheduling visit for a prepaid_package booking's setup path (none exists — prepaid packages never use setup mode)", async () => {
    // Sanity check on the bookingType guard: directly exercise
    // create-requested-visit-from-booking would be a package call anyway;
    // this test instead confirms handleSetupSessionCompleted's own guard
    // by constructing a normal booking order but simulating what would
    // happen if bookingType were somehow not 'normal' — guarded via the
    // repository-level bookingType check rather than re-deriving Stripe's
    // own mode routing here.
    const { repo } = createFakeBookingRepository();
    const bookingOrder = await repo.insertBookingOrder({ ...normalBookingOrderInput(), bookingType: "prepaid_package", visitCount: 6, frequency: "weekly", requestedDate: null, requestedStartTime: null, paymentAuthorizationAcceptedAt: null });
    await repo.updateBookingOrderStatus(bookingOrder.id, "draft", "awaiting_payment_method");
    const { repo: schedulingRepo, state: schedulingState } = createFakeSchedulingRepository();

    await processStripeWebhookEvent(
      fakeStripe(),
      repo,
      setupSessionEvent({ id: "cs_setup_5", mode: "setup", setup_intent: "seti_5", metadata: { booking_order_id: bookingOrder.id } }),
      schedulingRepo
    );

    expect(schedulingState.serviceVisitsById.size).toBe(0);
  });

  it("seeds exactly six universal recurring_visit_plans for a recurring (weekly) Pay Per Cleaning booking, slot #1 already linked to the direct visit", async () => {
    const { repo } = createFakeBookingRepository();
    const bookingOrder = await repo.insertBookingOrder(normalBookingOrderInput({ frequency: "weekly" }));
    await repo.updateBookingOrderStatus(bookingOrder.id, "draft", "awaiting_payment_method");
    const { repo: schedulingRepo, state: schedulingState } = createFakeSchedulingRepository();

    await processStripeWebhookEvent(
      fakeStripe(),
      repo,
      setupSessionEvent({ id: "cs_setup_6", mode: "setup", setup_intent: "seti_6", metadata: { booking_order_id: bookingOrder.id } }),
      schedulingRepo
    );

    // Exactly one direct service_visit — never six fake ones.
    expect(schedulingState.serviceVisitsById.size).toBe(1);
    const directVisit = [...schedulingState.serviceVisitsById.values()][0];

    expect(schedulingState.recurringVisitPlansById.size).toBe(6);
    const plans = [...schedulingState.recurringVisitPlansById.values()].sort((a, b) => a.visitNumber - b.visitNumber);
    expect(plans.map((p) => p.status)).toEqual(["linked", "planned", "planned", "planned", "planned", "planned"]);
    expect(plans[0].serviceVisitId).toBe(directVisit.id);
  });

  it("does not seed recurring_visit_plans at all for a one_time booking", async () => {
    const { repo } = createFakeBookingRepository();
    const bookingOrder = await repo.insertBookingOrder(normalBookingOrderInput({ frequency: "one_time" }));
    await repo.updateBookingOrderStatus(bookingOrder.id, "draft", "awaiting_payment_method");
    const { repo: schedulingRepo, state: schedulingState } = createFakeSchedulingRepository();

    await processStripeWebhookEvent(
      fakeStripe(),
      repo,
      setupSessionEvent({ id: "cs_setup_7", mode: "setup", setup_intent: "seti_7", metadata: { booking_order_id: bookingOrder.id } }),
      schedulingRepo
    );

    expect(schedulingState.recurringVisitPlansById.size).toBe(0);
  });

  it("does not duplicate the universal calendar on a redelivered/retried webhook event", async () => {
    const { repo } = createFakeBookingRepository();
    const bookingOrder = await repo.insertBookingOrder(normalBookingOrderInput({ frequency: "biweekly" }));
    await repo.updateBookingOrderStatus(bookingOrder.id, "draft", "awaiting_payment_method");
    const { repo: schedulingRepo, state: schedulingState } = createFakeSchedulingRepository();

    const event = setupSessionEvent({ id: "cs_setup_8", mode: "setup", setup_intent: "seti_8", metadata: { booking_order_id: bookingOrder.id } });
    await processStripeWebhookEvent(fakeStripe(), repo, event, schedulingRepo);
    await processStripeWebhookEvent(fakeStripe(), repo, event, schedulingRepo);

    expect(schedulingState.serviceVisitsById.size).toBe(1);
    expect(schedulingState.recurringVisitPlansById.size).toBe(6);
  });
});
