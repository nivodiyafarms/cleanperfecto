import { describe, expect, it } from "vitest";
import {
  CANCELLATION_POLICY_TIERS,
  PREPAID_PACKAGE_CANCELLATION_NOTE,
  PREPAID_PAYMENT_AUTHORIZATION_COPY,
  SAVED_PAYMENT_AUTHORIZATION_COPY,
  formatCancellationPolicySnapshot,
} from "./cancellation-policy";
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

describe("booking_orders.payment_authorization_text_snapshot", () => {
  it("persists the exact Pay Per Cleaning payment-authorization wording shown, frozen verbatim on the row (4)", async () => {
    const { repo } = createFakeBookingRepository();
    const bookingOrder = await repo.insertBookingOrder(
      minimalBookingOrderInput({ paymentAuthorizationTextSnapshot: SAVED_PAYMENT_AUTHORIZATION_COPY })
    );

    expect(bookingOrder.paymentAuthorizationTextSnapshot).toBe(SAVED_PAYMENT_AUTHORIZATION_COPY);
  });

  it("persists the exact Prepaid Package payment-authorization wording — distinct from the Pay Per Cleaning copy (5)", async () => {
    const { repo } = createFakeBookingRepository();
    const bookingOrder = await repo.insertBookingOrder(
      minimalBookingOrderInput({ bookingType: "prepaid_package", paymentAuthorizationTextSnapshot: PREPAID_PAYMENT_AUTHORIZATION_COPY })
    );

    expect(bookingOrder.paymentAuthorizationTextSnapshot).toBe(PREPAID_PAYMENT_AUTHORIZATION_COPY);
    expect(bookingOrder.paymentAuthorizationTextSnapshot).not.toBe(SAVED_PAYMENT_AUTHORIZATION_COPY);
  });
});

describe("formatCancellationPolicySnapshot", () => {
  it("renders every tier from the same source array the UI displays (3)", () => {
    const snapshot = formatCancellationPolicySnapshot(false);
    for (const tier of CANCELLATION_POLICY_TIERS) {
      expect(snapshot).toContain(tier.window);
      expect(snapshot).toContain(tier.fee);
    }
    expect(snapshot).not.toContain(PREPAID_PACKAGE_CANCELLATION_NOTE);
  });

  it("includes the prepaid-specific note only for a prepaid package (3)", () => {
    const snapshot = formatCancellationPolicySnapshot(true);
    expect(snapshot).toContain(PREPAID_PACKAGE_CANCELLATION_NOTE);
  });
});

describe("booking_orders.consent_version_id and cancellation_policy_text_snapshot (booking-level evidence trail)", () => {
  it("a Pay Per Cleaning booking stores the applicable Service Terms version and exact cancellation wording (1, 3)", async () => {
    const { repo } = createFakeBookingRepository();
    const bookingOrder = await repo.insertBookingOrder(
      minimalBookingOrderInput({
        consentVersionId: "version-1",
        cancellationPolicyTextSnapshot: formatCancellationPolicySnapshot(false),
      })
    );

    expect(bookingOrder.consentVersionId).toBe("version-1");
    expect(bookingOrder.cancellationPolicyTextSnapshot).toContain(CANCELLATION_POLICY_TIERS[0]!.window);
  });

  it("a Prepaid Package booking stores the applicable Service Terms version and prepaid-specific cancellation wording (2, 3)", async () => {
    const { repo } = createFakeBookingRepository();
    const bookingOrder = await repo.insertBookingOrder(
      minimalBookingOrderInput({
        bookingType: "prepaid_package",
        consentVersionId: "version-2",
        cancellationPolicyTextSnapshot: formatCancellationPolicySnapshot(true),
      })
    );

    expect(bookingOrder.consentVersionId).toBe("version-2");
    expect(bookingOrder.cancellationPolicyTextSnapshot).toContain(PREPAID_PACKAGE_CANCELLATION_NOTE);
  });

  it("one shared timestamp represents the combined checkbox — set once, alongside the other evidence fields on the same row (6)", async () => {
    const { repo } = createFakeBookingRepository();
    const acceptedAt = new Date().toISOString();
    const bookingOrder = await repo.insertBookingOrder(
      minimalBookingOrderInput({
        paymentAuthorizationAcceptedAt: acceptedAt,
        consentVersionId: "version-1",
        cancellationPolicyTextSnapshot: formatCancellationPolicySnapshot(false),
        paymentAuthorizationTextSnapshot: SAVED_PAYMENT_AUTHORIZATION_COPY,
      })
    );

    // All four pieces of evidence for the ONE combined acceptance live on
    // the same row, keyed to the same instant — not four independent
    // writes at different times.
    expect(bookingOrder.paymentAuthorizationAcceptedAt).toBe(acceptedAt);
    expect(bookingOrder.consentVersionId).toBe("version-1");
    expect(bookingOrder.cancellationPolicyTextSnapshot).not.toBeNull();
    expect(bookingOrder.paymentAuthorizationTextSnapshot).not.toBeNull();
  });

  it("legacy/pre-existing booking rows remain valid with every new evidence field null when omitted (8)", async () => {
    const { repo } = createFakeBookingRepository();
    const bookingOrder = await repo.insertBookingOrder(minimalBookingOrderInput());

    expect(bookingOrder.consentVersionId).toBeNull();
    expect(bookingOrder.cancellationPolicyTextSnapshot).toBeNull();
    expect(bookingOrder.paymentAuthorizationTextSnapshot).toBeNull();
  });

  it("a retried submission with the same clientRequestId returns the ORIGINAL accepted evidence unchanged, never overwritten by a second attempt (9, 10)", async () => {
    const { repo } = createFakeBookingRepository();
    const clientRequestId = "retry-test-req-1";

    const first = await repo.insertBookingOrder(
      minimalBookingOrderInput({
        clientRequestId,
        consentVersionId: "version-1",
        cancellationPolicyTextSnapshot: formatCancellationPolicySnapshot(false),
      })
    );

    // A hypothetical retry that (incorrectly) tried to present different
    // evidence must never be allowed to rewrite what was actually accepted.
    const second = await repo.insertBookingOrder(
      minimalBookingOrderInput({
        clientRequestId,
        consentVersionId: "version-2-tampered",
        cancellationPolicyTextSnapshot: "tampered snapshot",
      })
    );

    expect(second.id).toBe(first.id);
    expect(second.consentVersionId).toBe("version-1");
    expect(second.cancellationPolicyTextSnapshot).toBe(formatCancellationPolicySnapshot(false));
  });
});
