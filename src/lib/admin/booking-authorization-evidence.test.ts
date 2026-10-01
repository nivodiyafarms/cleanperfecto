import { describe, expect, it } from "vitest";
import { buildBookingAuthorizationEvidence } from "./booking-authorization-evidence";
import type { BookingOrderRow } from "@/lib/booking/types";

function minimalBookingOrder(overrides: Partial<BookingOrderRow> = {}): BookingOrderRow {
  return {
    id: "booking_1",
    customerId: "customer_1",
    quoteRequestId: "quote_1",
    clientRequestId: "client_req_1",
    bookingType: "normal",
    cleaningType: "standard",
    frequency: "one_time",
    visitCount: 1,
    status: "payment_completed",
    paymentAuthorizationAcceptedAt: null,
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
    cancellationPolicyVersion: null,
    consentVersionId: null,
    cancellationPolicyTextSnapshot: null,
    paymentAuthorizationTextSnapshot: null,
    ...overrides,
  } as BookingOrderRow;
}

describe("buildBookingAuthorizationEvidence", () => {
  it("reports no evidence when there is no booking order", () => {
    const evidence = buildBookingAuthorizationEvidence(null);
    expect(evidence.hasEvidence).toBe(false);
    expect(evidence.cancellationPolicyTextSnapshot).toBeNull();
  });

  it("reads the PERSISTED snapshot fields verbatim, never a live constant", () => {
    const bookingOrder = minimalBookingOrder({
      consentVersionId: "version-1",
      cancellationPolicyVersion: "2026-08-19b",
      cancellationPolicyTextSnapshot: "48+ hours before your appointment: Free cancellation or rescheduling",
      paymentAuthorizationTextSnapshot: "I agree to the cancellation/rescheduling policy...",
      paymentAuthorizationAcceptedAt: "2026-09-15T04:38:37.005Z",
    });

    const evidence = buildBookingAuthorizationEvidence(bookingOrder);

    expect(evidence.hasEvidence).toBe(true);
    expect(evidence.consentVersionId).toBe("version-1");
    expect(evidence.cancellationPolicyVersion).toBe("2026-08-19b");
    expect(evidence.cancellationPolicyTextSnapshot).toBe("48+ hours before your appointment: Free cancellation or rescheduling");
    expect(evidence.paymentAuthorizationTextSnapshot).toBe("I agree to the cancellation/rescheduling policy...");
    expect(evidence.paymentAuthorizationAcceptedAt).toBe("2026-09-15T04:38:37.005Z");
  });

  it("a historical booking's OLD snapshot is never replaced by the CURRENT policy wording, even though both may be non-null", () => {
    const historicalBooking = minimalBookingOrder({
      cancellationPolicyVersion: "2026-08-19b",
      cancellationPolicyTextSnapshot: "48+ hours before your appointment: Free cancellation or rescheduling",
    });

    const evidence = buildBookingAuthorizationEvidence(historicalBooking);

    // Never equals the current (2026-09-27) wording — proves this function
    // does not fall back to or overlay any live constant.
    expect(evidence.cancellationPolicyVersion).not.toBe("2026-09-27");
    expect(evidence.cancellationPolicyTextSnapshot).not.toContain("48 hours or more");
  });

  it("legacy rows with null evidence columns are shown as null, never backfilled with a guess", () => {
    const legacyBooking = minimalBookingOrder();
    const evidence = buildBookingAuthorizationEvidence(legacyBooking);

    expect(evidence.hasEvidence).toBe(true);
    expect(evidence.consentVersionId).toBeNull();
    expect(evidence.cancellationPolicyTextSnapshot).toBeNull();
    expect(evidence.paymentAuthorizationTextSnapshot).toBeNull();
  });
});
