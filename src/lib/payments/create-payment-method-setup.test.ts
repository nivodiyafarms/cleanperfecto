import { describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";
import { createFakeBookingRepository } from "@/lib/booking/test-support/fake-booking-repository";
import { createPaymentMethodSetupCheckoutSession } from "./create-payment-method-setup";

function fakeStripe(createImpl: (params: unknown) => Promise<unknown>): Stripe {
  return {
    customers: {
      update: vi.fn(async () => ({})),
    },
    checkout: {
      sessions: {
        create: vi.fn(createImpl),
      },
    },
  } as unknown as Stripe;
}

describe("createPaymentMethodSetupCheckoutSession", () => {
  it("restricts the customer-portal Add/Update Payment Method setup session to card only", async () => {
    let capturedParams: Record<string, unknown> = {};
    const stripe = fakeStripe(async (params) => {
      capturedParams = params as Record<string, unknown>;
      return { id: "cs_test_upm", url: "https://checkout.stripe.com/test" };
    });
    const { repo: bookingRepo } = createFakeBookingRepository({
      customers: {
        "customer-1": {
          id: "customer-1",
          name: "Jane",
          email: "jane@example.com",
          phone: null,
          stripeCustomerId: "cus_1",
          stripeDefaultPaymentMethodId: null,
          stripePaymentMethodBrand: null,
          stripePaymentMethodLast4: null,
        },
      },
    });

    await createPaymentMethodSetupCheckoutSession(
      stripe,
      bookingRepo,
      "customer-1",
      { serviceAddressLine1: "123 Main St", serviceAddressLine2: null, serviceCity: "Frisco", serviceState: "TX" },
      "75056"
    );

    expect(capturedParams.mode).toBe("setup");
    // Pay Per Cleaning's post-cleaning PaymentIntent is card-only
    // (visit-payment-gateway.ts) — a customer updating their saved payment
    // method here must never be able to save a non-card PaymentMethod
    // (e.g. Link) as their new default.
    expect(capturedParams.payment_method_types).toEqual(["card"]);
  });
});
