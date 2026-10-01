import { describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";
import { createFakeBookingRepository } from "../test-support/fake-booking-repository";
import { claimWebhookEvent } from "./claim-webhook-event";
import { createFakeSchedulingRepository } from "@/lib/scheduling/test-support/fake-scheduling-repository";
import { createFakeVisitPaymentGateway } from "@/lib/payments/test-support/fake-visit-payment-gateway";
import { prepareVisitPaymentReview } from "@/lib/payments/prepare-visit-payment-review";
import { selectVisitTip } from "@/lib/payments/select-visit-tip";
import { createVisitPaymentIntent } from "@/lib/payments/create-visit-payment-intent";
import { toStripeCents } from "@/lib/booking/stripe/money";
import { roundToCents } from "@/lib/pricing/money";
import type { NewBookingOrderRow } from "../types";
import type { NewServiceVisitRow } from "@/lib/scheduling/domain-types";
import { processStripeWebhookEvent } from "./process-stripe-webhook-event";

function fakeStripe(
  overrides: Partial<{
    setupIntentStatus: string;
    paymentIntentStatus: string;
    setupIntentPaymentMethod: string | null;
    /** Simulates the SetupIntent's resulting PaymentMethod type — default "card". Set to "link" (or any non-card value) to test the fail-closed capture behavior. */
    paymentMethodType: string;
  }> = {}
): Stripe {
  const paymentMethodType = overrides.paymentMethodType ?? "card";
  return {
    setupIntents: {
      retrieve: vi.fn(async () => ({
        status: overrides.setupIntentStatus ?? "succeeded",
        payment_method: overrides.setupIntentPaymentMethod ?? "pm_new",
        customer: "cus_1",
      })),
    },
    paymentIntents: {
      retrieve: vi.fn(async () => ({ status: overrides.paymentIntentStatus ?? "succeeded" })),
    },
    paymentMethods: {
      retrieve: vi.fn(async () => ({
        type: paymentMethodType,
        card: paymentMethodType === "card" ? { brand: "visa", last4: "4242", exp_month: 12, exp_year: 2030 } : null,
      })),
    },
    customers: {
      update: vi.fn(async () => ({})),
    },
  } as unknown as Stripe;
}

const NEW_VISIT: NewServiceVisitRow = {
  customerId: "customer-1",
  quoteRequestId: null,
  bookingOrderId: null,
  prepaidPackageId: null,
  recurringScheduleId: null,
  visitNumber: null,
  cleaningType: "standard",
  frequency: "one_time",
  requestedStartAt: new Date(),
  timezone: "America/Chicago",
  serviceAddressLine1: "123 Main St",
  serviceAddressLine2: null,
  serviceCity: "Frisco",
  serviceState: "TX",
  serviceAddressIdentity: "75056|123 MAIN ST|",
};

async function seedChargedVisitForWebhookTest() {
  const { repo: schedulingRepo, state } = createFakeSchedulingRepository();
  const visit = await schedulingRepo.insertServiceVisit(NEW_VISIT);
  await schedulingRepo.upsertServiceVisitPricing({
    serviceVisitId: visit.id,
    pricingVersion: "v1",
    pricingSnapshot: {},
    baseAmount: 179,
    addOnIds: [],
    addOnAmount: 0,
    totalAmount: 179,
    amountDueFromCustomer: 179,
    priceStatus: "estimated",
    requiresCustomerApproval: false,
    previouslyApprovedAmount: null,
  });
  await schedulingRepo.confirmServiceVisitPricing(visit.id, "admin:1");
  state.serviceVisitsById.set(visit.id, { ...(await schedulingRepo.findServiceVisitById(visit.id))!, status: "completed" });

  const { gateway } = createFakeVisitPaymentGateway();
  await prepareVisitPaymentReview(schedulingRepo, gateway, visit.id);
  await selectVisitTip(schedulingRepo, gateway, { serviceVisitId: visit.id, tipSelectionType: "percentage_15" });

  const { repo: bookingRepo } = createFakeBookingRepository({
    customers: { "customer-1": { id: "customer-1", name: "Jane", email: "jane@example.com", phone: null, stripeCustomerId: "cus_1", stripeDefaultPaymentMethodId: "pm_1", stripePaymentMethodBrand: "visa", stripePaymentMethodLast4: "4242" } },
  });
  const outcome = await createVisitPaymentIntent(schedulingRepo, bookingRepo, gateway, { serviceVisitId: visit.id, customerId: "customer-1" });
  if (outcome.outcome !== "ready") throw new Error("expected ready");

  const payment = (await schedulingRepo.findServiceVisitPaymentByVisitId(visit.id))!;
  return { schedulingRepo, gateway, visitId: visit.id, paymentIntentId: payment.stripePaymentIntentId!, totalAmount: payment.totalAmount! };
}

function paymentIntentEvent(
  type: "payment_intent.processing" | "payment_intent.requires_action" | "payment_intent.payment_failed" | "payment_intent.succeeded" | "payment_intent.canceled",
  intent: Partial<Stripe.PaymentIntent> & { id: string }
): Stripe.Event {
  return { id: `evt_${intent.id}_${type}`, type, data: { object: intent as Stripe.PaymentIntent } } as unknown as Stripe.Event;
}

function chargeRefundedEvent(charge: { id: string; payment_intent: string; amount: number; amount_refunded: number }): Stripe.Event {
  return { id: `evt_${charge.id}`, type: "charge.refunded", data: { object: charge as unknown as Stripe.Charge } } as unknown as Stripe.Event;
}

function minimalBookingOrderInput(bookingType: "normal" | "prepaid_package"): NewBookingOrderRow {
  return {
    customerId: "customer_1",
    quoteRequestId: "quote_1",
    clientRequestId: `client_req_${Math.random()}`,
    bookingType,
    cleaningType: "standard",
    frequency: bookingType === "prepaid_package" ? "weekly" : "one_time",
    visitCount: bookingType === "prepaid_package" ? 6 : 1,
    paymentAuthorizationAcceptedAt: bookingType === "normal" ? new Date().toISOString() : null,
    pricingVersion: "test-version",
    pricingSnapshot: { input: {} as never, result: {} as never },
    calculatedTotal: 100,
    displayRangeLower: 100,
    displayRangeUpper: 110,
    prepaidPackageTotal: bookingType === "prepaid_package" ? 600 : null,
    effectivePricePerVisit: bookingType === "prepaid_package" ? 100 : null,
    hasStartingAtPricing: false,
    manualReviewReasons: [],
    selectedAddOnIds: [],
    serviceAddressLine1: "123 Main St",
    serviceAddressLine2: null,
    serviceCity: "Frisco",
    serviceState: "TX",
    serviceAddressIdentity: "75056|123 main st|",
    requestedDate: bookingType === "normal" ? "2026-10-01" : null,
    requestedTimeWindow: bookingType === "normal" ? "morning" : null,
    requestedStartTime: bookingType === "normal" ? "09:00" : null,
    cancellationPolicyVersion: bookingType === "normal" ? "2026-08-19" : null,
  };
}

function checkoutSessionEvent(
  type: "checkout.session.completed" | "checkout.session.async_payment_succeeded" | "checkout.session.async_payment_failed" | "checkout.session.expired",
  session: Partial<Stripe.Checkout.Session> & { id: string }
): Stripe.Event {
  return {
    id: `evt_${session.id}`,
    type,
    data: { object: session as Stripe.Checkout.Session },
  } as unknown as Stripe.Event;
}

describe("processStripeWebhookEvent — prepaid package (payment mode)", () => {
  it("does not activate the package when payment_status is not 'paid'", async () => {
    const { repo, state } = createFakeBookingRepository();
    const bookingOrder = await repo.insertBookingOrder(minimalBookingOrderInput("prepaid_package"));
    await repo.updateBookingOrderStatus(bookingOrder.id, "draft", "awaiting_payment");
    await repo.insertPaymentAttempt({ bookingOrderId: bookingOrder.id, mode: "payment", stripeCheckoutSessionId: "cs_1", stripeCustomerId: "cus_1", amount: 600, paymentMethodType: null, packageSubtotalBeforeAchIncentive: null, achSavingsAmount: null });

    await processStripeWebhookEvent(
      fakeStripe(),
      repo,
      checkoutSessionEvent("checkout.session.completed", {
        id: "cs_1",
        mode: "payment",
        payment_status: "unpaid",
        metadata: { booking_order_id: bookingOrder.id },
      })
    );

    expect(state.prepaidPackagesByBookingOrderId.size).toBe(0);
    expect((await repo.findBookingOrderById(bookingOrder.id))?.status).toBe("awaiting_payment");
  });

  it("activates the package on a verified async_payment_succeeded event, exactly once even if redelivered", async () => {
    const { repo, state } = createFakeBookingRepository();
    const bookingOrder = await repo.insertBookingOrder(minimalBookingOrderInput("prepaid_package"));
    await repo.updateBookingOrderStatus(bookingOrder.id, "draft", "awaiting_payment");
    await repo.insertPaymentAttempt({ bookingOrderId: bookingOrder.id, mode: "payment", stripeCheckoutSessionId: "cs_2", stripeCustomerId: "cus_1", amount: 600, paymentMethodType: null, packageSubtotalBeforeAchIncentive: null, achSavingsAmount: null });

    const event = checkoutSessionEvent("checkout.session.async_payment_succeeded", {
      id: "cs_2",
      mode: "payment",
      payment_status: "paid",
      payment_intent: "pi_1",
      metadata: { booking_order_id: bookingOrder.id },
    });

    await processStripeWebhookEvent(fakeStripe(), repo, event);
    await processStripeWebhookEvent(fakeStripe(), repo, event); // simulated redelivery

    expect(state.prepaidPackagesByBookingOrderId.size).toBe(1);
    expect((await repo.findBookingOrderById(bookingOrder.id))?.status).toBe("payment_completed");
  });

  it("never activates on async_payment_failed", async () => {
    const { repo, state } = createFakeBookingRepository();
    const bookingOrder = await repo.insertBookingOrder(minimalBookingOrderInput("prepaid_package"));
    await repo.updateBookingOrderStatus(bookingOrder.id, "draft", "awaiting_payment");
    await repo.insertPaymentAttempt({ bookingOrderId: bookingOrder.id, mode: "payment", stripeCheckoutSessionId: "cs_3", stripeCustomerId: "cus_1", amount: 600, paymentMethodType: null, packageSubtotalBeforeAchIncentive: null, achSavingsAmount: null });

    await processStripeWebhookEvent(
      fakeStripe(),
      repo,
      checkoutSessionEvent("checkout.session.async_payment_failed", { id: "cs_3", mode: "payment", metadata: { booking_order_id: bookingOrder.id } })
    );

    expect(state.prepaidPackagesByBookingOrderId.size).toBe(0);
    expect((await repo.findBookingOrderById(bookingOrder.id))?.status).toBe("awaiting_payment");
    expect(state.paymentAttemptsById.get([...state.paymentAttemptsById.keys()][0])?.status).toBe("failed");
  });

  it("does not activate when the PaymentIntent cross-check reports anything other than succeeded", async () => {
    const { repo, state } = createFakeBookingRepository();
    const bookingOrder = await repo.insertBookingOrder(minimalBookingOrderInput("prepaid_package"));
    await repo.updateBookingOrderStatus(bookingOrder.id, "draft", "awaiting_payment");
    await repo.insertPaymentAttempt({ bookingOrderId: bookingOrder.id, mode: "payment", stripeCheckoutSessionId: "cs_4", stripeCustomerId: "cus_1", amount: 600, paymentMethodType: null, packageSubtotalBeforeAchIncentive: null, achSavingsAmount: null });

    await processStripeWebhookEvent(
      fakeStripe({ paymentIntentStatus: "requires_action" }),
      repo,
      checkoutSessionEvent("checkout.session.completed", {
        id: "cs_4",
        mode: "payment",
        payment_status: "paid",
        payment_intent: "pi_2",
        metadata: { booking_order_id: bookingOrder.id },
      })
    );

    expect(state.prepaidPackagesByBookingOrderId.size).toBe(0);
  });
});

describe("processStripeWebhookEvent — prepaid package tax accounting", () => {
  it("persists the real Stripe-charged principal, tax, and total from the settled Checkout Session — never the pre-tax total alone", async () => {
    const { repo, state } = createFakeBookingRepository();
    const bookingOrder = await repo.insertBookingOrder(minimalBookingOrderInput("prepaid_package")); // prepaidPackageTotal: 600
    await repo.updateBookingOrderStatus(bookingOrder.id, "draft", "awaiting_payment");
    await repo.insertPaymentAttempt({ bookingOrderId: bookingOrder.id, mode: "payment", stripeCheckoutSessionId: "cs_tax_1", stripeCustomerId: "cus_1", amount: 600, paymentMethodType: null, packageSubtotalBeforeAchIncentive: null, achSavingsAmount: null });

    const { gateway, state: gatewayState } = createFakeVisitPaymentGateway();
    gatewayState.taxAssociationByPaymentIntentId.set("pi_tax_1", { committedTransactionId: "txn_package_purchase_1", erroredReason: null });

    await processStripeWebhookEvent(
      fakeStripe(),
      repo,
      checkoutSessionEvent("checkout.session.completed", {
        id: "cs_tax_1",
        mode: "payment",
        payment_status: "paid",
        payment_intent: "pi_tax_1",
        amount_subtotal: 60000,
        amount_total: 64950,
        total_details: { amount_tax: 4950 } as Stripe.Checkout.Session.TotalDetails,
        metadata: { booking_order_id: bookingOrder.id },
      }),
      undefined,
      undefined,
      gateway
    );

    const pkg = state.prepaidPackagesByBookingOrderId.get(bookingOrder.id)!;
    expect(pkg.packageTotalPaid).toBe(600);
    expect(pkg.taxAmount).toBe(49.5);
    expect(pkg.totalAmountPaid).toBe(649.5);
    expect(pkg.stripeTaxTransactionId).toBe("txn_package_purchase_1");
    // The immutable fact every downstream refund/tax-reversal calculation depends on.
    expect(roundToCents(pkg.packageTotalPaid + pkg.taxAmount!)).toBe(pkg.totalAmountPaid);
  });

  it("records tax_amount as 0 (not null, not skipped) when Stripe reports no tax on the session", async () => {
    const { repo, state } = createFakeBookingRepository();
    const bookingOrder = await repo.insertBookingOrder(minimalBookingOrderInput("prepaid_package"));
    await repo.updateBookingOrderStatus(bookingOrder.id, "draft", "awaiting_payment");
    await repo.insertPaymentAttempt({ bookingOrderId: bookingOrder.id, mode: "payment", stripeCheckoutSessionId: "cs_tax_2", stripeCustomerId: "cus_1", amount: 600, paymentMethodType: null, packageSubtotalBeforeAchIncentive: null, achSavingsAmount: null });

    await processStripeWebhookEvent(
      fakeStripe(),
      repo,
      checkoutSessionEvent("checkout.session.completed", {
        id: "cs_tax_2",
        mode: "payment",
        payment_status: "paid",
        payment_intent: "pi_tax_2",
        amount_subtotal: 60000,
        amount_total: 60000,
        total_details: { amount_tax: 0 } as Stripe.Checkout.Session.TotalDetails,
        metadata: { booking_order_id: bookingOrder.id },
      })
    );

    const pkg = state.prepaidPackagesByBookingOrderId.get(bookingOrder.id)!;
    expect(pkg.taxAmount).toBe(0);
    expect(pkg.totalAmountPaid).toBe(600);
  });

  it("still activates with tax fields left null when the session carries no total_details/amount_total at all (legacy-shaped event)", async () => {
    const { repo, state } = createFakeBookingRepository();
    const bookingOrder = await repo.insertBookingOrder(minimalBookingOrderInput("prepaid_package"));
    await repo.updateBookingOrderStatus(bookingOrder.id, "draft", "awaiting_payment");
    await repo.insertPaymentAttempt({ bookingOrderId: bookingOrder.id, mode: "payment", stripeCheckoutSessionId: "cs_tax_3", stripeCustomerId: "cus_1", amount: 600, paymentMethodType: null, packageSubtotalBeforeAchIncentive: null, achSavingsAmount: null });

    await processStripeWebhookEvent(
      fakeStripe(),
      repo,
      checkoutSessionEvent("checkout.session.completed", {
        id: "cs_tax_3",
        mode: "payment",
        payment_status: "paid",
        payment_intent: "pi_tax_3",
        metadata: { booking_order_id: bookingOrder.id },
      })
    );

    const pkg = state.prepaidPackagesByBookingOrderId.get(bookingOrder.id)!;
    expect(pkg.packageTotalPaid).toBe(600); // the one value never allowed to go missing
    expect(pkg.taxAmount).toBeNull();
    expect(pkg.totalAmountPaid).toBeNull();
    expect(pkg.stripeTaxTransactionId).toBeNull();
  });

  it("a redelivered/duplicate webhook never double-activates or double-records tax — exactly one package, first delivery's values win", async () => {
    const { repo, state } = createFakeBookingRepository();
    const bookingOrder = await repo.insertBookingOrder(minimalBookingOrderInput("prepaid_package"));
    await repo.updateBookingOrderStatus(bookingOrder.id, "draft", "awaiting_payment");
    await repo.insertPaymentAttempt({ bookingOrderId: bookingOrder.id, mode: "payment", stripeCheckoutSessionId: "cs_tax_4", stripeCustomerId: "cus_1", amount: 600, paymentMethodType: null, packageSubtotalBeforeAchIncentive: null, achSavingsAmount: null });

    const event = checkoutSessionEvent("checkout.session.completed", {
      id: "cs_tax_4",
      mode: "payment",
      payment_status: "paid",
      payment_intent: "pi_tax_4",
      amount_subtotal: 60000,
      amount_total: 64950,
      total_details: { amount_tax: 4950 } as Stripe.Checkout.Session.TotalDetails,
      metadata: { booking_order_id: bookingOrder.id },
    });

    await processStripeWebhookEvent(fakeStripe(), repo, event);
    await processStripeWebhookEvent(fakeStripe(), repo, event); // simulated redelivery
    await processStripeWebhookEvent(fakeStripe(), repo, event); // and again

    expect(state.prepaidPackagesByBookingOrderId.size).toBe(1);
    const pkg = state.prepaidPackagesByBookingOrderId.get(bookingOrder.id)!;
    expect(pkg.taxAmount).toBe(49.5);
    expect(pkg.totalAmountPaid).toBe(649.5);
  });
});

describe("processStripeWebhookEvent — normal booking (setup mode)", () => {
  it("moves the booking order to pending_confirmation only when the SetupIntent is verified succeeded", async () => {
    const { repo } = createFakeBookingRepository();
    const bookingOrder = await repo.insertBookingOrder(minimalBookingOrderInput("normal"));
    await repo.updateBookingOrderStatus(bookingOrder.id, "draft", "awaiting_payment_method");
    await repo.insertPaymentAttempt({ bookingOrderId: bookingOrder.id, mode: "setup", stripeCheckoutSessionId: "cs_5", stripeCustomerId: "cus_1", amount: null, paymentMethodType: null, packageSubtotalBeforeAchIncentive: null, achSavingsAmount: null });

    await processStripeWebhookEvent(
      fakeStripe({ setupIntentStatus: "succeeded" }),
      repo,
      checkoutSessionEvent("checkout.session.completed", { id: "cs_5", mode: "setup", setup_intent: "seti_1", metadata: { booking_order_id: bookingOrder.id } })
    );

    expect((await repo.findBookingOrderById(bookingOrder.id))?.status).toBe("pending_confirmation");
  });

  it("does not move the booking order (and never claims a payment) when the SetupIntent is not yet succeeded", async () => {
    const { repo } = createFakeBookingRepository();
    const bookingOrder = await repo.insertBookingOrder(minimalBookingOrderInput("normal"));
    await repo.updateBookingOrderStatus(bookingOrder.id, "draft", "awaiting_payment_method");
    await repo.insertPaymentAttempt({ bookingOrderId: bookingOrder.id, mode: "setup", stripeCheckoutSessionId: "cs_6", stripeCustomerId: "cus_1", amount: null, paymentMethodType: null, packageSubtotalBeforeAchIncentive: null, achSavingsAmount: null });

    await processStripeWebhookEvent(
      fakeStripe({ setupIntentStatus: "requires_action" }),
      repo,
      checkoutSessionEvent("checkout.session.completed", { id: "cs_6", mode: "setup", setup_intent: "seti_2", metadata: { booking_order_id: bookingOrder.id } })
    );

    expect((await repo.findBookingOrderById(bookingOrder.id))?.status).toBe("awaiting_payment_method");
  });
});

describe("processStripeWebhookEvent — expiry", () => {
  it("marks the payment attempt expired without touching the booking order status", async () => {
    const { repo, state } = createFakeBookingRepository();
    const bookingOrder = await repo.insertBookingOrder(minimalBookingOrderInput("prepaid_package"));
    await repo.updateBookingOrderStatus(bookingOrder.id, "draft", "awaiting_payment");
    await repo.insertPaymentAttempt({ bookingOrderId: bookingOrder.id, mode: "payment", stripeCheckoutSessionId: "cs_7", stripeCustomerId: "cus_1", amount: 600, paymentMethodType: null, packageSubtotalBeforeAchIncentive: null, achSavingsAmount: null });

    await processStripeWebhookEvent(
      fakeStripe(),
      repo,
      checkoutSessionEvent("checkout.session.expired", { id: "cs_7", mode: "payment", metadata: { booking_order_id: bookingOrder.id } })
    );

    expect(state.paymentAttemptsById.get([...state.paymentAttemptsById.keys()][0])?.status).toBe("expired");
    expect((await repo.findBookingOrderById(bookingOrder.id))?.status).toBe("awaiting_payment");
  });
});

describe("processStripeWebhookEvent — update payment method (setup, no booking_order_id)", () => {
  it("captures the new default payment method for purpose='update_payment_method' without requiring a booking_order_id", async () => {
    const { repo } = createFakeBookingRepository({
      customers: { "customer-1": { id: "customer-1", name: "Jane", email: "jane@example.com", phone: null, stripeCustomerId: "cus_1", stripeDefaultPaymentMethodId: "pm_old", stripePaymentMethodBrand: "mastercard", stripePaymentMethodLast4: "4444" } },
    });

    await processStripeWebhookEvent(
      fakeStripe({ setupIntentPaymentMethod: "pm_new" }),
      repo,
      checkoutSessionEvent("checkout.session.completed", {
        id: "cs_upm_1",
        mode: "setup",
        setup_intent: "seti_upm_1",
        metadata: { purpose: "update_payment_method", customer_id: "customer-1" },
      })
    );

    const customer = await repo.getCustomerForStripe("customer-1");
    expect(customer?.stripeDefaultPaymentMethodId).toBe("pm_new");
    expect(customer?.stripePaymentMethodBrand).toBe("visa");
    expect(customer?.stripePaymentMethodLast4).toBe("4242");
  });

  it("fails closed for a non-card PaymentMethod (e.g. Link) — never persists it as the customer default, never updates the Stripe Customer invoice default", async () => {
    const { repo } = createFakeBookingRepository({
      customers: { "customer-1": { id: "customer-1", name: "Jane", email: "jane@example.com", phone: null, stripeCustomerId: "cus_1", stripeDefaultPaymentMethodId: "pm_old", stripePaymentMethodBrand: "mastercard", stripePaymentMethodLast4: "4444" } },
    });
    const stripe = fakeStripe({ setupIntentPaymentMethod: "pm_link_new", paymentMethodType: "link" });

    await processStripeWebhookEvent(
      stripe,
      repo,
      checkoutSessionEvent("checkout.session.completed", {
        id: "cs_upm_link",
        mode: "setup",
        setup_intent: "seti_upm_link",
        metadata: { purpose: "update_payment_method", customer_id: "customer-1" },
      })
    );

    // The customer's existing (card) default is left completely untouched
    // — a null brand/last4 is never treated as proof the non-card PM is
    // usable; the whole capture is skipped.
    const customer = await repo.getCustomerForStripe("customer-1");
    expect(customer?.stripeDefaultPaymentMethodId).toBe("pm_old");
    expect(customer?.stripePaymentMethodBrand).toBe("mastercard");
    expect(customer?.stripePaymentMethodLast4).toBe("4444");
    expect(stripe.customers.update).not.toHaveBeenCalled();
  });

  it("does nothing when the SetupIntent has not succeeded", async () => {
    const { repo } = createFakeBookingRepository({
      customers: { "customer-1": { id: "customer-1", name: "Jane", email: "jane@example.com", phone: null, stripeCustomerId: "cus_1", stripeDefaultPaymentMethodId: "pm_old", stripePaymentMethodBrand: "mastercard", stripePaymentMethodLast4: "4444" } },
    });

    await processStripeWebhookEvent(
      fakeStripe({ setupIntentStatus: "requires_action" }),
      repo,
      checkoutSessionEvent("checkout.session.completed", {
        id: "cs_upm_2",
        mode: "setup",
        setup_intent: "seti_upm_2",
        metadata: { purpose: "update_payment_method", customer_id: "customer-1" },
      })
    );

    const customer = await repo.getCustomerForStripe("customer-1");
    expect(customer?.stripeDefaultPaymentMethodId).toBe("pm_old");
  });
});

describe("processStripeWebhookEvent — payment_intent.* (Pay Per Cleaning + Tipping)", () => {
  it("payment_intent.succeeded reconciles the visit payment to paid when schedulingRepo and paymentGateway are supplied", async () => {
    const { schedulingRepo, gateway, visitId, paymentIntentId } = await seedChargedVisitForWebhookTest();

    await processStripeWebhookEvent(
      fakeStripe(),
      createFakeBookingRepository().repo,
      paymentIntentEvent("payment_intent.succeeded", { id: paymentIntentId }),
      schedulingRepo,
      undefined,
      gateway
    );

    const payment = await schedulingRepo.findServiceVisitPaymentByVisitId(visitId);
    expect(payment!.status).toBe("paid");
  });

  it("payment_intent.payment_failed reconciles to payment_failed and preserves the failure reason", async () => {
    const { schedulingRepo, gateway, visitId, paymentIntentId } = await seedChargedVisitForWebhookTest();

    await processStripeWebhookEvent(
      fakeStripe(),
      createFakeBookingRepository().repo,
      paymentIntentEvent("payment_intent.payment_failed", {
        id: paymentIntentId,
        last_payment_error: { code: "card_declined", message: "Your card was declined." } as Stripe.PaymentIntent["last_payment_error"],
      }),
      schedulingRepo,
      undefined,
      gateway
    );

    const payment = await schedulingRepo.findServiceVisitPaymentByVisitId(visitId);
    expect(payment!.status).toBe("payment_failed");
    expect(payment!.failureCode).toBe("card_declined");
  });

  it("is a silent no-op when schedulingRepo or paymentGateway is not supplied — never throws", async () => {
    const { paymentIntentId } = await seedChargedVisitForWebhookTest();

    await expect(
      processStripeWebhookEvent(fakeStripe(), createFakeBookingRepository().repo, paymentIntentEvent("payment_intent.succeeded", { id: paymentIntentId }))
    ).resolves.toBeUndefined();
  });

  it("payment_intent.canceled reconciles to payment_failed with a cancellation-specific failure code", async () => {
    const { schedulingRepo, gateway, visitId, paymentIntentId } = await seedChargedVisitForWebhookTest();

    await processStripeWebhookEvent(
      fakeStripe(),
      createFakeBookingRepository().repo,
      paymentIntentEvent("payment_intent.canceled", { id: paymentIntentId, cancellation_reason: "abandoned" }),
      schedulingRepo,
      undefined,
      gateway
    );

    const payment = await schedulingRepo.findServiceVisitPaymentByVisitId(visitId);
    expect(payment!.status).toBe("payment_failed");
    expect(payment!.failureCode).toBe("abandoned");
  });

  it("payment_intent.canceled arriving AFTER the same PaymentIntent already succeeded must never regress paid -> payment_failed", async () => {
    const { schedulingRepo, gateway, visitId, paymentIntentId } = await seedChargedVisitForWebhookTest();
    await processStripeWebhookEvent(fakeStripe(), createFakeBookingRepository().repo, paymentIntentEvent("payment_intent.succeeded", { id: paymentIntentId }), schedulingRepo, undefined, gateway);

    await processStripeWebhookEvent(
      fakeStripe(),
      createFakeBookingRepository().repo,
      paymentIntentEvent("payment_intent.canceled", { id: paymentIntentId, cancellation_reason: "abandoned" }),
      schedulingRepo,
      undefined,
      gateway
    );

    const payment = await schedulingRepo.findServiceVisitPaymentByVisitId(visitId);
    expect(payment!.status).toBe("paid");
  });

  it("PAYMENT_MODE=stripe_sandbox never fulfills a LIVE-mode event — explicit mode mismatch is a safe no-op", async () => {
    const { schedulingRepo, gateway, visitId, paymentIntentId } = await seedChargedVisitForWebhookTest();
    const liveEvent = { ...paymentIntentEvent("payment_intent.succeeded", { id: paymentIntentId }), livemode: true };

    await processStripeWebhookEvent(fakeStripe(), createFakeBookingRepository().repo, liveEvent, schedulingRepo, undefined, gateway, "stripe_sandbox");

    const payment = await schedulingRepo.findServiceVisitPaymentByVisitId(visitId);
    expect(payment!.status).not.toBe("paid");
  });

  it("PAYMENT_MODE=stripe_enabled never fulfills a TEST-mode event — explicit mode mismatch is a safe no-op", async () => {
    const { schedulingRepo, gateway, visitId, paymentIntentId } = await seedChargedVisitForWebhookTest();
    const testEvent = { ...paymentIntentEvent("payment_intent.succeeded", { id: paymentIntentId }), livemode: false };

    await processStripeWebhookEvent(fakeStripe(), createFakeBookingRepository().repo, testEvent, schedulingRepo, undefined, gateway, "stripe_enabled");

    const payment = await schedulingRepo.findServiceVisitPaymentByVisitId(visitId);
    expect(payment!.status).not.toBe("paid");
  });

  it("PAYMENT_MODE=disabled never fulfills any Stripe card event, even a correctly-matched livemode", async () => {
    const { schedulingRepo, gateway, visitId, paymentIntentId } = await seedChargedVisitForWebhookTest();
    const event = { ...paymentIntentEvent("payment_intent.succeeded", { id: paymentIntentId }), livemode: false };

    await processStripeWebhookEvent(fakeStripe(), createFakeBookingRepository().repo, event, schedulingRepo, undefined, gateway, "disabled");

    const payment = await schedulingRepo.findServiceVisitPaymentByVisitId(visitId);
    expect(payment!.status).not.toBe("paid");
  });

  it("a correctly-matched livemode still fulfills normally", async () => {
    const { schedulingRepo, gateway, visitId, paymentIntentId } = await seedChargedVisitForWebhookTest();
    const event = { ...paymentIntentEvent("payment_intent.succeeded", { id: paymentIntentId }), livemode: false };

    await processStripeWebhookEvent(fakeStripe(), createFakeBookingRepository().repo, event, schedulingRepo, undefined, gateway, "stripe_sandbox");

    const payment = await schedulingRepo.findServiceVisitPaymentByVisitId(visitId);
    expect(payment!.status).toBe("paid");
  });
});

describe("processStripeWebhookEvent — charge.refunded", () => {
  it("reconciles a full refund without altering tip/tax/total", async () => {
    const { schedulingRepo, gateway, visitId, paymentIntentId, totalAmount } = await seedChargedVisitForWebhookTest();
    await processStripeWebhookEvent(fakeStripe(), createFakeBookingRepository().repo, paymentIntentEvent("payment_intent.succeeded", { id: paymentIntentId }), schedulingRepo, undefined, gateway);

    await processStripeWebhookEvent(
      fakeStripe(),
      createFakeBookingRepository().repo,
      chargeRefundedEvent({ id: "ch_1", payment_intent: paymentIntentId, amount: toStripeCents(totalAmount), amount_refunded: toStripeCents(totalAmount) }),
      schedulingRepo
    );

    const payment = await schedulingRepo.findServiceVisitPaymentByVisitId(visitId);
    expect(payment!.status).toBe("refunded");
    expect(payment!.totalAmount).toBeCloseTo(totalAmount, 2);
  });

  it("is a silent no-op when schedulingRepo is not supplied", async () => {
    const { paymentIntentId } = await seedChargedVisitForWebhookTest();

    await expect(
      processStripeWebhookEvent(fakeStripe(), createFakeBookingRepository().repo, chargeRefundedEvent({ id: "ch_2", payment_intent: paymentIntentId, amount: 100, amount_refunded: 100 }))
    ).resolves.toBeUndefined();
  });
});

describe("processStripeWebhookEvent — mode-mismatch cannot later fulfill after PAYMENT_MODE changes", () => {
  it("a skipped mode-mismatched event, once marked processed (replicating route.ts's exact sequence), is a permanent no-op even after the mode changes to one that would have matched", async () => {
    const { schedulingRepo, gateway, visitId, paymentIntentId } = await seedChargedVisitForWebhookTest();
    const bookingRepo = createFakeBookingRepository().repo;
    const liveEvent = { ...paymentIntentEvent("payment_intent.succeeded", { id: paymentIntentId }), livemode: true };

    // --- First delivery, replicating route.ts: claim -> process -> mark processed ---
    const claim1 = await claimWebhookEvent(bookingRepo, liveEvent.id, liveEvent.type, liveEvent as unknown as Record<string, unknown>);
    expect(claim1.shouldProcess).toBe(true);
    await processStripeWebhookEvent(fakeStripe(), bookingRepo, liveEvent, schedulingRepo, undefined, gateway, "stripe_sandbox");
    await bookingRepo.markWebhookEventProcessed(claim1.eventRowId);

    const paymentAfterFirstDelivery = await schedulingRepo.findServiceVisitPaymentByVisitId(visitId);
    expect(paymentAfterFirstDelivery!.status).not.toBe("paid"); // never fulfilled — mode mismatch

    // --- Stripe redelivers the SAME event id; meanwhile PAYMENT_MODE has
    // changed to stripe_enabled, which WOULD now match this live event.
    // The ledger's own dedup must still refuse to reprocess it, regardless. ---
    const claim2 = await claimWebhookEvent(bookingRepo, liveEvent.id, liveEvent.type, liveEvent as unknown as Record<string, unknown>);
    expect(claim2.shouldProcess).toBe(false); // permanent no-op — route.ts would return 200 without ever calling processStripeWebhookEvent again

    // Sanity: even if something did call the domain function again with
    // the now-matching mode, this proves the reason the visit stays
    // unfulfilled is the ledger's dedup, not a coincidental second guard
    // failure — the schedulingRepo state was genuinely never mutated.
    const paymentAfterRedelivery = await schedulingRepo.findServiceVisitPaymentByVisitId(visitId);
    expect(paymentAfterRedelivery!.status).not.toBe("paid");
  });
});
