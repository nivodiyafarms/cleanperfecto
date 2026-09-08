import { describe, expect, it } from "vitest";
import { SAVED_PAYMENT_AUTHORIZATION_COPY, PREPAID_PAYMENT_AUTHORIZATION_COPY } from "./cancellation-policy";
import { createFakeBookingRepository } from "./test-support/fake-booking-repository";
import type { NewBookingOrderRow } from "./types";

function minimalBookingOrderInput(overrides: Partial<NewBookingOrderRow> = {}): NewBookingOrderRow {
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
    requestedTimeWindow: null,
    requestedStartTime: "10:00",
    cancellationPolicyVersion: "2026-08-19b",
    ...overrides,
  };
}

describe("booking_orders.payment_authorization_text_snapshot (consent evidence audit)", () => {
  it("persists the exact Pay Per Cleaning payment-authorization wording shown, frozen verbatim on the row", async () => {
    const { repo } = createFakeBookingRepository();
    const bookingOrder = await repo.insertBookingOrder(
      minimalBookingOrderInput({ paymentAuthorizationTextSnapshot: SAVED_PAYMENT_AUTHORIZATION_COPY })
    );

    expect(bookingOrder.paymentAuthorizationTextSnapshot).toBe(SAVED_PAYMENT_AUTHORIZATION_COPY);
  });

  it("persists the exact Prepaid Package payment-authorization wording — distinct from the Pay Per Cleaning copy", async () => {
    const { repo } = createFakeBookingRepository();
    const bookingOrder = await repo.insertBookingOrder(
      minimalBookingOrderInput({ bookingType: "prepaid_package", paymentAuthorizationTextSnapshot: PREPAID_PAYMENT_AUTHORIZATION_COPY })
    );

    expect(bookingOrder.paymentAuthorizationTextSnapshot).toBe(PREPAID_PAYMENT_AUTHORIZATION_COPY);
    expect(bookingOrder.paymentAuthorizationTextSnapshot).not.toBe(SAVED_PAYMENT_AUTHORIZATION_COPY);
  });

  it("defaults to null when omitted — historical/legacy rows stay honestly distinguishable, never backfilled with an invented value", async () => {
    const { repo } = createFakeBookingRepository();
    const bookingOrder = await repo.insertBookingOrder(minimalBookingOrderInput());

    expect(bookingOrder.paymentAuthorizationTextSnapshot).toBeNull();
  });
});
