import { describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";
import {
  createPrepaidAchCheckoutSession,
  createPrepaidCardCheckoutSession,
  createSetupCheckoutSession,
  RESIDENTIAL_CLEANING_TAX_CODE,
} from "./checkout-sessions";

function fakeStripe(createImpl: (params: unknown, options: unknown) => Promise<unknown>): Stripe {
  return {
    checkout: {
      sessions: {
        create: vi.fn(createImpl),
      },
    },
  } as unknown as Stripe;
}

describe("createSetupCheckoutSession", () => {
  it("uses server-authoritative USD, restricts to card only, and uses the provided idempotency key", async () => {
    let capturedParams: Record<string, unknown> = {};
    let capturedOptions: Record<string, unknown> = {};
    const stripe = fakeStripe(async (params, options) => {
      capturedParams = params as Record<string, unknown>;
      capturedOptions = options as Record<string, unknown>;
      return { id: "cs_test_setup", url: "https://checkout.stripe.com/test" };
    });

    await createSetupCheckoutSession(stripe, {
      stripeCustomerId: "cus_123",
      bookingOrderId: "booking_1",
      successUrl: "https://example.com/success",
      cancelUrl: "https://example.com/cancel",
      idempotencyKey: "key-1",
    });

    // Setup mode saves a payment method with no charge. USD is
    // server-authoritative, never sourced from the customer/request.
    // payment_method_types is explicitly card-only — Pay Per Cleaning's
    // post-cleaning PaymentIntent is card-only (visit-payment-gateway.ts),
    // so this setup step must never let a non-card method (e.g. Link)
    // become the customer's saved default.
    expect(capturedParams.mode).toBe("setup");
    expect(capturedParams.currency).toBe("usd");
    expect(capturedParams.payment_method_types).toEqual(["card"]);
    expect(capturedOptions.idempotencyKey).toBe("key-1");

    // Setup mode is not a payment: no line items, no amount fields.
    expect(capturedParams).not.toHaveProperty("line_items");
    expect(capturedParams).not.toHaveProperty("amount_total");
    expect(capturedParams).not.toHaveProperty("payment_intent_data");
  });
});

describe("createPrepaidCardCheckoutSession", () => {
  it("enables automatic_tax, tags the line item with the residential cleaning tax code, restricts to card only, and never includes a hardcoded tax amount/rate", async () => {
    let capturedParams: Record<string, unknown> = {};
    const stripe = fakeStripe(async (params) => {
      capturedParams = params as Record<string, unknown>;
      return { id: "cs_test_payment", url: "https://checkout.stripe.com/test" };
    });

    await createPrepaidCardCheckoutSession(stripe, {
      stripeCustomerId: "cus_123",
      bookingOrderId: "booking_1",
      packageSubtotal: 700.01,
      productName: "Weekly 6-Cleaning Prepaid Package",
      successUrl: "https://example.com/success",
      cancelUrl: "https://example.com/cancel",
      idempotencyKey: "key-2",
    });

    expect(capturedParams.mode).toBe("payment");
    // Isolated from ACH: card and ACH have different prices for the same
    // package, so this session must never settle via any other method.
    expect(capturedParams.payment_method_types).toEqual(["card"]);
    expect((capturedParams.automatic_tax as { enabled: boolean }).enabled).toBe(true);

    const lineItems = capturedParams.line_items as Array<{ price_data: { unit_amount: number; product_data: { tax_code: string } } }>;
    expect(lineItems[0].price_data.unit_amount).toBe(70001);
    expect(lineItems[0].price_data.product_data.tax_code).toBe(RESIDENTIAL_CLEANING_TAX_CODE);

    // No tax_rates / manual percentage fields anywhere in the request —
    // Stripe Tax owns the tax amount entirely.
    expect(capturedParams).not.toHaveProperty("tax_rates");
    expect(JSON.stringify(capturedParams)).not.toMatch(/tax_rate|"percentage"/i);
  });
});

describe("createPrepaidAchCheckoutSession", () => {
  it("enables automatic_tax on the already-ACH-discounted amount, tags the tax code, restricts to us_bank_account only, and never saves the payment method for future use", async () => {
    let capturedParams: Record<string, unknown> = {};
    const stripe = fakeStripe(async (params) => {
      capturedParams = params as Record<string, unknown>;
      return { id: "cs_test_ach", url: "https://checkout.stripe.com/test" };
    });

    await createPrepaidAchCheckoutSession(stripe, {
      stripeCustomerId: "cus_123",
      bookingOrderId: "booking_1",
      packageSubtotal: 762.92, // already the ACH-discounted amount, never the card amount
      productName: "Weekly 6-Cleaning Prepaid Package",
      successUrl: "https://example.com/success",
      cancelUrl: "https://example.com/cancel",
      idempotencyKey: "key-3",
    });

    expect(capturedParams.mode).toBe("payment");
    expect(capturedParams.payment_method_types).toEqual(["us_bank_account"]);
    expect((capturedParams.automatic_tax as { enabled: boolean }).enabled).toBe(true);
    expect(capturedParams).not.toHaveProperty("setup_future_usage");

    const lineItems = capturedParams.line_items as Array<{ price_data: { unit_amount: number; product_data: { tax_code: string } } }>;
    expect(lineItems[0].price_data.unit_amount).toBe(76292);
    expect(lineItems[0].price_data.product_data.tax_code).toBe(RESIDENTIAL_CLEANING_TAX_CODE);

    expect(capturedParams).not.toHaveProperty("tax_rates");
    expect(JSON.stringify(capturedParams)).not.toMatch(/tax_rate|"percentage"/i);
  });
});
