import { describe, expect, it } from "vitest";
import {
  CANCELLATION_POLICY_TIERS,
  NO_ACCESS_FEE_REPLACEMENT_NOTE,
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

  it("includes the $75-replaces note for BOTH a normal booking and a prepaid package — it is not payment-model-specific", () => {
    expect(formatCancellationPolicySnapshot(false)).toContain(NO_ACCESS_FEE_REPLACEMENT_NOTE);
    expect(formatCancellationPolicySnapshot(true)).toContain(NO_ACCESS_FEE_REPLACEMENT_NOTE);
  });
});

describe("historical evidence is never silently rewritten", () => {
  it("a booking's persisted cancellation_policy_version and cancellation_policy_text_snapshot stay frozen to whatever was true when it was created — a later CANCELLATION_POLICY_VERSION/wording revision never reaches back into an existing row", async () => {
    const { repo } = createFakeBookingRepository();
    const bookingOrder = await repo.insertBookingOrder(
      minimalBookingOrderInput({
        cancellationPolicyVersion: "2026-08-19b",
        cancellationPolicyTextSnapshot: "48+ hours before your appointment: Free cancellation or rescheduling",
      })
    );

    // The row keeps its OWN frozen text, regardless of what the CURRENT
    // constants say — application code has no update path for this field at
    // all (see fake-booking-repository.ts's updateBookingOrderStatus, the
    // only mutation ever performed on a booking_orders row), mirroring the
    // real DB's protect_booking_order_consent_evidence trigger.
    expect(bookingOrder.cancellationPolicyVersion).toBe("2026-08-19b");
    expect(bookingOrder.cancellationPolicyTextSnapshot).not.toContain(NO_ACCESS_FEE_REPLACEMENT_NOTE);

    await repo.updateBookingOrderStatus(bookingOrder.id, "draft", "awaiting_payment_method");
    const after = await repo.findBookingOrderById(bookingOrder.id);

    expect(after?.cancellationPolicyVersion).toBe("2026-08-19b");
    expect(after?.cancellationPolicyTextSnapshot).toBe(bookingOrder.cancellationPolicyTextSnapshot);
    expect(after?.consentVersionId).toBe(bookingOrder.consentVersionId);
    expect(after?.paymentAuthorizationTextSnapshot).toBe(bookingOrder.paymentAuthorizationTextSnapshot);
    expect(after?.paymentAuthorizationAcceptedAt).toBe(bookingOrder.paymentAuthorizationAcceptedAt);
  });

  it("a NEW booking created after the wording revision correctly captures the updated policy — old and new bookings can coexist with different frozen snapshots", async () => {
    const { repo } = createFakeBookingRepository();
    const oldBooking = await repo.insertBookingOrder(
      minimalBookingOrderInput({ cancellationPolicyVersion: "2026-08-19b", cancellationPolicyTextSnapshot: "an old snapshot" })
    );
    const newBooking = await repo.insertBookingOrder(
      minimalBookingOrderInput({
        clientRequestId: "new-booking-req",
        cancellationPolicyVersion: "2026-09-27",
        cancellationPolicyTextSnapshot: formatCancellationPolicySnapshot(false),
      })
    );

    expect(oldBooking.cancellationPolicyTextSnapshot).toBe("an old snapshot");
    expect(newBooking.cancellationPolicyTextSnapshot).toContain(NO_ACCESS_FEE_REPLACEMENT_NOTE);
    expect(oldBooking.cancellationPolicyTextSnapshot).not.toBe(newBooking.cancellationPolicyTextSnapshot);
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
