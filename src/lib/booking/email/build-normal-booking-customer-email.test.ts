import { describe, expect, it } from "vitest";
import { buildNormalBookingCustomerEmail } from "./build-normal-booking-customer-email";
import { buildNormalBookingAdminEmail } from "./build-normal-booking-admin-email";
import type { BookingEmailDetails } from "./booking-email-details";
import type { BookingOrderRow } from "../types";

function fakeDetails(): BookingEmailDetails {
  const bookingOrder: BookingOrderRow = {
    id: "booking_1",
    customerId: "customer_1",
    quoteRequestId: "quote_1",
    clientRequestId: "req_1",
    bookingType: "normal",
    cleaningType: "standard",
    frequency: "weekly",
    visitCount: 1,
    status: "pending_confirmation",
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

  return { bookingOrder, customerName: "Jamie Customer", customerEmail: "jamie@example.com", customerPhone: "+14695551234" };
}

describe("normal booking emails", () => {
  it("the customer email never claims the card was charged/paid", () => {
    const { text, html } = buildNormalBookingCustomerEmail(fakeDetails());
    expect(text.toLowerCase()).not.toMatch(/\bpaid\b|\bcharged\b(?! today)/);
    expect(html.toLowerCase()).not.toMatch(/\bpaid\b/);
    expect(text).toMatch(/not been charged/i);
  });

  it("the admin email states the payment status as pending confirmation, never paid", () => {
    const { text } = buildNormalBookingAdminEmail(fakeDetails());
    expect(text).toMatch(/pending confirmation/i);
    expect(text.toLowerCase()).not.toContain("paid");
  });
});
