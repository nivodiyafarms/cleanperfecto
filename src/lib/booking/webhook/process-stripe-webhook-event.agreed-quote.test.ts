import { describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";
import type { AgreedQuoteInvitationRepository, AgreedQuoteInvitationRow } from "@/lib/instant-quote/agreed-quote-invitation-repository";
import { createFakeBookingRepository } from "../test-support/fake-booking-repository";
import { processStripeWebhookEvent } from "./process-stripe-webhook-event";
import type { NewBookingOrderRow } from "../types";

function fakeStripe(): Stripe {
  return {
    setupIntents: { retrieve: vi.fn(async () => ({ status: "succeeded", payment_method: "pm_new", customer: "cus_1" })) },
    paymentIntents: { retrieve: vi.fn(async () => ({ status: "succeeded", payment_method: null })) },
    paymentMethods: { retrieve: vi.fn(async () => ({ type: "card", card: { brand: "visa", last4: "4242", exp_month: 12, exp_year: 2030 } })) },
    customers: { update: vi.fn(async () => ({})) },
  } as unknown as Stripe;
}

function minimalBookingOrderInput(bookingType: "normal" | "prepaid_package"): NewBookingOrderRow {
  return {
    customerId: "customer-1",
    quoteRequestId: "quote-1",
    clientRequestId: `client-req-${Math.random()}`,
    bookingType,
    cleaningType: "standard",
    frequency: bookingType === "prepaid_package" ? "weekly" : "one_time",
    visitCount: bookingType === "prepaid_package" ? 6 : 1,
    paymentAuthorizationAcceptedAt: bookingType === "normal" ? new Date().toISOString() : null,
    pricingVersion: "manual-agreed-v1",
    pricingSnapshot: { input: {} as never, result: {} as never },
    calculatedTotal: 300,
    displayRangeLower: 300,
    displayRangeUpper: 300,
    prepaidPackageTotal: bookingType === "prepaid_package" ? 1800 : null,
    effectivePricePerVisit: bookingType === "prepaid_package" ? 300 : null,
    hasStartingAtPricing: false,
    manualReviewReasons: [],
    selectedAddOnIds: [],
    serviceAddressLine1: "123 Main St",
    serviceAddressLine2: null,
    serviceCity: "Frisco",
    serviceState: "TX",
    serviceAddressIdentity: "75056|123 main st|",
    requestedDate: null,
    requestedTimeWindow: null,
    requestedStartTime: null,
    cancellationPolicyVersion: null,
  };
}

function checkoutSessionEvent(
  type: "checkout.session.completed",
  session: Partial<Stripe.Checkout.Session> & { id: string }
): Stripe.Event {
  return { id: `evt_${session.id}`, type, data: { object: session as Stripe.Checkout.Session } } as unknown as Stripe.Event;
}

function fakeInvitationRepo(invitationId: string, bookingOrderId: string, options: { failOnce?: boolean } = {}) {
  let row: AgreedQuoteInvitationRow = {
    id: invitationId,
    quoteRequestId: "quote-1",
    customerId: "customer-1",
    createdByAdminUserId: "admin-1",
    status: "checkout_in_progress",
    clientRequestId: "client-req-1",
    negotiationChannel: null,
    negotiationNotes: null,
    agreedRequestedDate: null,
    agreedRequestedStartTime: null,
    resendCount: 0,
    lastSentAt: null,
    expiresAt: new Date(Date.now() + 1000000).toISOString(),
    renewCount: 0,
    renewedAt: null,
    renewedByAdminUserId: null,
    supersedesInvitationId: null,
    supersededAt: null,
    bookingOrderId,
    checkoutStartedAt: new Date().toISOString(),
    completedAt: null,
    cancelledAt: null,
    cancelledByAdminUserId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  let callCount = 0;

  const repo: AgreedQuoteInvitationRepository = {
    async insertAgreedQuoteInvitation() {
      throw new Error("not used");
    },
    async findAgreedQuoteInvitationById() {
      return row;
    },
    async findAgreedQuoteInvitationSummaryById() {
      throw new Error("not used");
    },
    async listAgreedQuoteInvitationSummaries() {
      throw new Error("not used");
    },
    async supersedeAgreedQuoteInvitation() {
      return null;
    },
    async claimAgreedQuoteInvitationSend() {
      throw new Error("not used");
    },
    async markAgreedQuoteInvitationSendSent() {},
    async markAgreedQuoteInvitationSendFailedTerminal() {},
    async recordAgreedQuoteInvitationSent() {},
    async renewAgreedQuoteInvitation() {
      throw new Error("not used");
    },
    async linkAgreedQuoteInvitationBookingOrder() {
      throw new Error("not used");
    },
    async claimAgreedQuoteInvitationCheckout() {
      throw new Error("not used");
    },
    async claimAgreedQuoteInvitationCancellation() {
      throw new Error("not used");
    },
    async markAgreedQuoteInvitationCompletedByBookingOrderId(bookingOrderIdArg: string, completedAt: Date) {
      callCount += 1;
      if (options.failOnce && callCount === 1) {
        throw new Error("simulated transient DB error on the first delivery");
      }
      if (row.bookingOrderId === bookingOrderIdArg && row.status === "checkout_in_progress") {
        row = { ...row, status: "completed", completedAt: completedAt.toISOString() };
      }
    },
    async hasLivePaymentAttemptForBookingOrder() {
      return false;
    },
  };

  return { repo, getRow: () => row };
}

describe("process-stripe-webhook-event — agreed-quote invitation completion hook", () => {
  it("flips the invitation to completed once the setup session is verified, in the same delivery as the booking_orders transition", async () => {
    const { repo: bookingRepo } = createFakeBookingRepository();
    const bookingOrder = await bookingRepo.insertBookingOrder(minimalBookingOrderInput("normal"));
    await bookingRepo.updateBookingOrderStatus(bookingOrder.id, "draft", "awaiting_payment_method");
    await bookingRepo.insertPaymentAttempt({
      bookingOrderId: bookingOrder.id,
      mode: "setup",
      stripeCheckoutSessionId: "cs_1",
      stripeCustomerId: "cus_1",
      amount: null,
      paymentMethodType: null,
      packageSubtotalBeforeAchIncentive: null,
      achSavingsAmount: null,
    });

    const { repo: invitationRepo, getRow } = fakeInvitationRepo("invitation-1", bookingOrder.id);

    await processStripeWebhookEvent(
      fakeStripe(),
      bookingRepo,
      checkoutSessionEvent("checkout.session.completed", { id: "cs_1", mode: "setup", setup_intent: "seti_1", metadata: { booking_order_id: bookingOrder.id } }),
      undefined,
      undefined,
      undefined,
      "stripe_sandbox",
      invitationRepo
    );

    expect(getRow().status).toBe("completed");
    expect(getRow().completedAt).not.toBeNull();
    const updatedOrder = await bookingRepo.findBookingOrderById(bookingOrder.id);
    expect(updatedOrder?.status).toBe("pending_confirmation");
  });

  it("recovers on retry when a prior delivery updated booking_orders but crashed before the invitation update", async () => {
    const { repo: bookingRepo } = createFakeBookingRepository();
    const bookingOrder = await bookingRepo.insertBookingOrder(minimalBookingOrderInput("normal"));
    await bookingRepo.updateBookingOrderStatus(bookingOrder.id, "draft", "awaiting_payment_method");
    await bookingRepo.insertPaymentAttempt({
      bookingOrderId: bookingOrder.id,
      mode: "setup",
      stripeCheckoutSessionId: "cs_2",
      stripeCustomerId: "cus_1",
      amount: null,
      paymentMethodType: null,
      packageSubtotalBeforeAchIncentive: null,
      achSavingsAmount: null,
    });

    const { repo: invitationRepo, getRow } = fakeInvitationRepo("invitation-2", bookingOrder.id, { failOnce: true });
    const event = checkoutSessionEvent("checkout.session.completed", { id: "cs_2", mode: "setup", setup_intent: "seti_2", metadata: { booking_order_id: bookingOrder.id } });

    // First delivery: booking_orders transitions successfully, but the
    // invitation-completion hook throws (simulating a crash) — the whole
    // handler must propagate that failure (never swallow it), which is
    // exactly what lets the outer webhook claim/retry machinery redeliver.
    await expect(
      processStripeWebhookEvent(fakeStripe(), bookingRepo, event, undefined, undefined, undefined, "stripe_sandbox", invitationRepo)
    ).rejects.toThrow("simulated transient DB error");

    const afterFirstDelivery = await bookingRepo.findBookingOrderById(bookingOrder.id);
    expect(afterFirstDelivery?.status).toBe("pending_confirmation");
    expect(getRow().status).toBe("checkout_in_progress"); // still stuck after the first, failed delivery

    // Retry (second delivery of the SAME event): booking_orders is already
    // in its target status, so `changed` is false this time — but the
    // invitation-completion hook must NOT be skipped because of that; it
    // must run again (unconditionally) and this time succeed.
    await processStripeWebhookEvent(fakeStripe(), bookingRepo, event, undefined, undefined, undefined, "stripe_sandbox", invitationRepo);

    expect(getRow().status).toBe("completed");
  });

  it("is a no-op for a booking order with no associated agreed-quote invitation", async () => {
    const { repo: bookingRepo } = createFakeBookingRepository();
    const bookingOrder = await bookingRepo.insertBookingOrder(minimalBookingOrderInput("normal"));
    await bookingRepo.updateBookingOrderStatus(bookingOrder.id, "draft", "awaiting_payment_method");
    await bookingRepo.insertPaymentAttempt({
      bookingOrderId: bookingOrder.id,
      mode: "setup",
      stripeCheckoutSessionId: "cs_3",
      stripeCustomerId: "cus_1",
      amount: null,
      paymentMethodType: null,
      packageSubtotalBeforeAchIncentive: null,
      achSavingsAmount: null,
    });

    // No agreedQuoteInvitationRepo supplied at all — must not throw.
    await expect(
      processStripeWebhookEvent(
        fakeStripe(),
        bookingRepo,
        checkoutSessionEvent("checkout.session.completed", { id: "cs_3", mode: "setup", setup_intent: "seti_3", metadata: { booking_order_id: bookingOrder.id } }),
        undefined,
        undefined,
        undefined,
        "stripe_sandbox"
      )
    ).resolves.not.toThrow();
  });
});
