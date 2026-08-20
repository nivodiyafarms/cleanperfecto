import { describe, expect, it } from "vitest";
import { createFakeBookingRepository } from "./test-support/fake-booking-repository";
import type { NewBookingOrderRow } from "./types";

function minimalBookingOrderInput(clientRequestId: string): NewBookingOrderRow {
  return {
    customerId: "customer_1",
    quoteRequestId: "quote_1",
    clientRequestId,
    bookingType: "normal",
    cleaningType: "standard",
    frequency: "weekly",
    visitCount: 1,
    paymentAuthorizationAcceptedAt: new Date().toISOString(),
    pricingVersion: "test-version",
    pricingSnapshot: { input: {} as never, result: {} as never },
    calculatedTotal: 150,
    displayRangeLower: 150,
    displayRangeUpper: 165,
    prepaidPackageTotal: null,
    effectivePricePerVisit: null,
    hasStartingAtPricing: false,
    manualReviewReasons: [],
    selectedAddOnIds: [],
    serviceAddressLine1: "1 Test Ave",
    serviceAddressLine2: null,
    serviceCity: "Frisco",
    serviceState: "TX",
    serviceAddressIdentity: "75056|1 test ave|",
    requestedDate: "2026-10-01",
    requestedTimeWindow: "afternoon",
    requestedStartTime: "14:00",
    cancellationPolicyVersion: "2026-08-19",
  };
}

describe("BookingRepository.insertBookingOrder — client_request_id idempotency", () => {
  it("resubmitting the same client_request_id resolves to exactly one booking order", async () => {
    const { repo, state } = createFakeBookingRepository();
    const token = "same-submission-token";

    const first = await repo.insertBookingOrder(minimalBookingOrderInput(token));
    const secondAttempt = await repo.insertBookingOrder(minimalBookingOrderInput(token));

    expect(secondAttempt.id).toBe(first.id);
    expect(state.bookingOrdersById.size).toBe(1);
  });

  it("a different client_request_id creates a genuinely separate booking order", async () => {
    const { repo, state } = createFakeBookingRepository();
    await repo.insertBookingOrder(minimalBookingOrderInput("token-a"));
    await repo.insertBookingOrder(minimalBookingOrderInput("token-b"));

    expect(state.bookingOrdersById.size).toBe(2);
  });
});
