import { describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";
import { getOrCreateCheckoutSessionUrl } from "./create-checkout-attempt";
import { createFakeBookingRepository } from "./test-support/fake-booking-repository";
import type { NewBookingOrderRow } from "./types";

function fakeStripe(sessionStatus: "open" | "expired" | "complete") {
  return {
    checkout: {
      sessions: {
        retrieve: vi.fn(async (id: string) => ({ id, status: sessionStatus, url: `https://checkout.stripe.com/${id}` })),
      },
    },
  } as unknown as Stripe;
}

function minimalBookingOrderInput(): NewBookingOrderRow {
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
    calculatedTotal: 100,
    displayRangeLower: 100,
    displayRangeUpper: 110,
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
    requestedTimeWindow: "morning",
    requestedStartTime: "09:00",
    cancellationPolicyVersion: "2026-08-19",
  };
}

describe("getOrCreateCheckoutSessionUrl", () => {
  it("creates a fresh attempt when none exists yet", async () => {
    const { repo, state } = createFakeBookingRepository();
    const bookingOrder = await repo.insertBookingOrder(minimalBookingOrderInput());
    const stripe = fakeStripe("open");
    const createSession = vi.fn(async () => ({ id: "cs_new", url: "https://checkout.stripe.com/cs_new" }) as Stripe.Checkout.Session);

    const url = await getOrCreateCheckoutSessionUrl({
      repo,
      stripe,
      bookingOrderId: bookingOrder.id,
      mode: "setup",
      stripeCustomerId: "cus_1",
      amount: null,
      createSession,
    });

    expect(url).toBe("https://checkout.stripe.com/cs_new");
    expect(createSession).toHaveBeenCalledTimes(1);
    expect(state.paymentAttemptsById.size).toBe(1);
  });

  it("reuses a still-open prior attempt instead of creating a duplicate", async () => {
    const { repo, state } = createFakeBookingRepository();
    const bookingOrder = await repo.insertBookingOrder(minimalBookingOrderInput());
    await repo.insertPaymentAttempt({
      bookingOrderId: bookingOrder.id,
      mode: "setup",
      stripeCheckoutSessionId: "cs_existing",
      stripeCustomerId: "cus_1",
      amount: null,
      paymentMethodType: null,
      packageSubtotalBeforeAchIncentive: null,
      achSavingsAmount: null,
    });

    const stripe = fakeStripe("open");
    const createSession = vi.fn(async () => ({ id: "cs_should_not_be_created", url: "https://checkout.stripe.com/nope" }) as Stripe.Checkout.Session);

    const url = await getOrCreateCheckoutSessionUrl({
      repo,
      stripe,
      bookingOrderId: bookingOrder.id,
      mode: "setup",
      stripeCustomerId: "cus_1",
      amount: null,
      createSession,
    });

    expect(url).toBe("https://checkout.stripe.com/cs_existing");
    expect(createSession).not.toHaveBeenCalled();
    expect(state.paymentAttemptsById.size).toBe(1);
  });

  it("creates a new attempt (never a new booking order) when the prior session has expired", async () => {
    const { repo, state } = createFakeBookingRepository();
    const bookingOrder = await repo.insertBookingOrder(minimalBookingOrderInput());
    await repo.insertPaymentAttempt({
      bookingOrderId: bookingOrder.id,
      mode: "setup",
      stripeCheckoutSessionId: "cs_expired",
      stripeCustomerId: "cus_1",
      amount: null,
      paymentMethodType: null,
      packageSubtotalBeforeAchIncentive: null,
      achSavingsAmount: null,
    });

    const stripe = fakeStripe("expired");
    const createSession = vi.fn(async () => ({ id: "cs_retry", url: "https://checkout.stripe.com/cs_retry" }) as Stripe.Checkout.Session);

    const url = await getOrCreateCheckoutSessionUrl({
      repo,
      stripe,
      bookingOrderId: bookingOrder.id,
      mode: "setup",
      stripeCustomerId: "cus_1",
      amount: null,
      createSession,
    });

    expect(url).toBe("https://checkout.stripe.com/cs_retry");
    expect(createSession).toHaveBeenCalledTimes(1);
    // Two attempts now exist for the SAME booking order — never a second
    // booking order.
    expect(state.paymentAttemptsById.size).toBe(2);
    expect(state.bookingOrdersById.size).toBe(1);
  });
});
