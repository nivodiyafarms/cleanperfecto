import { describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";
import { createFakeBookingRepository } from "../test-support/fake-booking-repository";
import type { NewBookingOrderRow } from "../types";
import { processStripeWebhookEvent } from "./process-stripe-webhook-event";

function fakeStripe(overrides: Partial<{ setupIntentStatus: string; paymentIntentStatus: string }> = {}): Stripe {
  return {
    setupIntents: {
      retrieve: vi.fn(async () => ({ status: overrides.setupIntentStatus ?? "succeeded" })),
    },
    paymentIntents: {
      retrieve: vi.fn(async () => ({ status: overrides.paymentIntentStatus ?? "succeeded" })),
    },
  } as unknown as Stripe;
}

function minimalBookingOrderInput(bookingType: "normal" | "prepaid_package"): NewBookingOrderRow {
  return {
    customerId: "customer_1",
    quoteRequestId: "quote_1",
    clientRequestId: `client_req_${Math.random()}`,
    bookingType,
    cleaningType: "standard",
    frequency: bookingType === "prepaid_package" ? "weekly" : "one_time",
    visitCount: bookingType === "prepaid_package" ? 6 : 1,
    paymentAuthorizationAcceptedAt: bookingType === "normal" ? new Date().toISOString() : null,
    pricingVersion: "test-version",
    pricingSnapshot: { input: {} as never, result: {} as never },
    calculatedTotal: 100,
    displayRangeLower: 100,
    displayRangeUpper: 110,
    prepaidPackageTotal: bookingType === "prepaid_package" ? 600 : null,
    effectivePricePerVisit: bookingType === "prepaid_package" ? 100 : null,
    hasStartingAtPricing: false,
    manualReviewReasons: [],
    selectedAddOnIds: [],
    serviceAddressLine1: "123 Main St",
    serviceAddressLine2: null,
    serviceCity: "Frisco",
    serviceState: "TX",
    serviceAddressIdentity: "75056|123 main st|",
    requestedDate: bookingType === "normal" ? "2026-10-01" : null,
    requestedTimeWindow: bookingType === "normal" ? "morning" : null,
    requestedStartTime: bookingType === "normal" ? "09:00" : null,
    cancellationPolicyVersion: bookingType === "normal" ? "2026-08-19" : null,
  };
}

function checkoutSessionEvent(
  type: "checkout.session.completed" | "checkout.session.async_payment_succeeded" | "checkout.session.async_payment_failed" | "checkout.session.expired",
  session: Partial<Stripe.Checkout.Session> & { id: string }
): Stripe.Event {
  return {
    id: `evt_${session.id}`,
    type,
    data: { object: session as Stripe.Checkout.Session },
  } as unknown as Stripe.Event;
}

describe("processStripeWebhookEvent — prepaid package (payment mode)", () => {
  it("does not activate the package when payment_status is not 'paid'", async () => {
    const { repo, state } = createFakeBookingRepository();
    const bookingOrder = await repo.insertBookingOrder(minimalBookingOrderInput("prepaid_package"));
    await repo.updateBookingOrderStatus(bookingOrder.id, "draft", "awaiting_payment");
    await repo.insertPaymentAttempt({ bookingOrderId: bookingOrder.id, mode: "payment", stripeCheckoutSessionId: "cs_1", stripeCustomerId: "cus_1", amount: 600, paymentMethodType: null, packageSubtotalBeforeAchIncentive: null, achSavingsAmount: null });

    await processStripeWebhookEvent(
      fakeStripe(),
      repo,
      checkoutSessionEvent("checkout.session.completed", {
        id: "cs_1",
        mode: "payment",
        payment_status: "unpaid",
        metadata: { booking_order_id: bookingOrder.id },
      })
    );

    expect(state.prepaidPackagesByBookingOrderId.size).toBe(0);
    expect((await repo.findBookingOrderById(bookingOrder.id))?.status).toBe("awaiting_payment");
  });

  it("activates the package on a verified async_payment_succeeded event, exactly once even if redelivered", async () => {
    const { repo, state } = createFakeBookingRepository();
    const bookingOrder = await repo.insertBookingOrder(minimalBookingOrderInput("prepaid_package"));
    await repo.updateBookingOrderStatus(bookingOrder.id, "draft", "awaiting_payment");
    await repo.insertPaymentAttempt({ bookingOrderId: bookingOrder.id, mode: "payment", stripeCheckoutSessionId: "cs_2", stripeCustomerId: "cus_1", amount: 600, paymentMethodType: null, packageSubtotalBeforeAchIncentive: null, achSavingsAmount: null });

    const event = checkoutSessionEvent("checkout.session.async_payment_succeeded", {
      id: "cs_2",
      mode: "payment",
      payment_status: "paid",
      payment_intent: "pi_1",
      metadata: { booking_order_id: bookingOrder.id },
    });

    await processStripeWebhookEvent(fakeStripe(), repo, event);
    await processStripeWebhookEvent(fakeStripe(), repo, event); // simulated redelivery

    expect(state.prepaidPackagesByBookingOrderId.size).toBe(1);
    expect((await repo.findBookingOrderById(bookingOrder.id))?.status).toBe("payment_completed");
  });

  it("never activates on async_payment_failed", async () => {
    const { repo, state } = createFakeBookingRepository();
    const bookingOrder = await repo.insertBookingOrder(minimalBookingOrderInput("prepaid_package"));
    await repo.updateBookingOrderStatus(bookingOrder.id, "draft", "awaiting_payment");
    await repo.insertPaymentAttempt({ bookingOrderId: bookingOrder.id, mode: "payment", stripeCheckoutSessionId: "cs_3", stripeCustomerId: "cus_1", amount: 600, paymentMethodType: null, packageSubtotalBeforeAchIncentive: null, achSavingsAmount: null });

    await processStripeWebhookEvent(
      fakeStripe(),
      repo,
      checkoutSessionEvent("checkout.session.async_payment_failed", { id: "cs_3", mode: "payment", metadata: { booking_order_id: bookingOrder.id } })
    );

    expect(state.prepaidPackagesByBookingOrderId.size).toBe(0);
    expect((await repo.findBookingOrderById(bookingOrder.id))?.status).toBe("awaiting_payment");
    expect(state.paymentAttemptsById.get([...state.paymentAttemptsById.keys()][0])?.status).toBe("failed");
  });

  it("does not activate when the PaymentIntent cross-check reports anything other than succeeded", async () => {
    const { repo, state } = createFakeBookingRepository();
    const bookingOrder = await repo.insertBookingOrder(minimalBookingOrderInput("prepaid_package"));
    await repo.updateBookingOrderStatus(bookingOrder.id, "draft", "awaiting_payment");
    await repo.insertPaymentAttempt({ bookingOrderId: bookingOrder.id, mode: "payment", stripeCheckoutSessionId: "cs_4", stripeCustomerId: "cus_1", amount: 600, paymentMethodType: null, packageSubtotalBeforeAchIncentive: null, achSavingsAmount: null });

    await processStripeWebhookEvent(
      fakeStripe({ paymentIntentStatus: "requires_action" }),
      repo,
      checkoutSessionEvent("checkout.session.completed", {
        id: "cs_4",
        mode: "payment",
        payment_status: "paid",
        payment_intent: "pi_2",
        metadata: { booking_order_id: bookingOrder.id },
      })
    );

    expect(state.prepaidPackagesByBookingOrderId.size).toBe(0);
  });
});

describe("processStripeWebhookEvent — normal booking (setup mode)", () => {
  it("moves the booking order to pending_confirmation only when the SetupIntent is verified succeeded", async () => {
    const { repo } = createFakeBookingRepository();
    const bookingOrder = await repo.insertBookingOrder(minimalBookingOrderInput("normal"));
    await repo.updateBookingOrderStatus(bookingOrder.id, "draft", "awaiting_payment_method");
    await repo.insertPaymentAttempt({ bookingOrderId: bookingOrder.id, mode: "setup", stripeCheckoutSessionId: "cs_5", stripeCustomerId: "cus_1", amount: null, paymentMethodType: null, packageSubtotalBeforeAchIncentive: null, achSavingsAmount: null });

    await processStripeWebhookEvent(
      fakeStripe({ setupIntentStatus: "succeeded" }),
      repo,
      checkoutSessionEvent("checkout.session.completed", { id: "cs_5", mode: "setup", setup_intent: "seti_1", metadata: { booking_order_id: bookingOrder.id } })
    );

    expect((await repo.findBookingOrderById(bookingOrder.id))?.status).toBe("pending_confirmation");
  });

  it("does not move the booking order (and never claims a payment) when the SetupIntent is not yet succeeded", async () => {
    const { repo } = createFakeBookingRepository();
    const bookingOrder = await repo.insertBookingOrder(minimalBookingOrderInput("normal"));
    await repo.updateBookingOrderStatus(bookingOrder.id, "draft", "awaiting_payment_method");
    await repo.insertPaymentAttempt({ bookingOrderId: bookingOrder.id, mode: "setup", stripeCheckoutSessionId: "cs_6", stripeCustomerId: "cus_1", amount: null, paymentMethodType: null, packageSubtotalBeforeAchIncentive: null, achSavingsAmount: null });

    await processStripeWebhookEvent(
      fakeStripe({ setupIntentStatus: "requires_action" }),
      repo,
      checkoutSessionEvent("checkout.session.completed", { id: "cs_6", mode: "setup", setup_intent: "seti_2", metadata: { booking_order_id: bookingOrder.id } })
    );

    expect((await repo.findBookingOrderById(bookingOrder.id))?.status).toBe("awaiting_payment_method");
  });
});

describe("processStripeWebhookEvent — expiry", () => {
  it("marks the payment attempt expired without touching the booking order status", async () => {
    const { repo, state } = createFakeBookingRepository();
    const bookingOrder = await repo.insertBookingOrder(minimalBookingOrderInput("prepaid_package"));
    await repo.updateBookingOrderStatus(bookingOrder.id, "draft", "awaiting_payment");
    await repo.insertPaymentAttempt({ bookingOrderId: bookingOrder.id, mode: "payment", stripeCheckoutSessionId: "cs_7", stripeCustomerId: "cus_1", amount: 600, paymentMethodType: null, packageSubtotalBeforeAchIncentive: null, achSavingsAmount: null });

    await processStripeWebhookEvent(
      fakeStripe(),
      repo,
      checkoutSessionEvent("checkout.session.expired", { id: "cs_7", mode: "payment", metadata: { booking_order_id: bookingOrder.id } })
    );

    expect(state.paymentAttemptsById.get([...state.paymentAttemptsById.keys()][0])?.status).toBe("expired");
    expect((await repo.findBookingOrderById(bookingOrder.id))?.status).toBe("awaiting_payment");
  });
});
