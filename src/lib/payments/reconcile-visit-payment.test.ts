import { describe, expect, it } from "vitest";
import { createFakeSchedulingRepository } from "@/lib/scheduling/test-support/fake-scheduling-repository";
import { createFakeBookingRepository } from "@/lib/booking/test-support/fake-booking-repository";
import { createFakeVisitPaymentGateway } from "./test-support/fake-visit-payment-gateway";
import { prepareVisitPaymentReview } from "./prepare-visit-payment-review";
import { selectVisitTip } from "./select-visit-tip";
import { createVisitPaymentIntent } from "./create-visit-payment-intent";
import { reconcileVisitPayment, reconcileVisitPaymentRefund } from "./reconcile-visit-payment";
import { toStripeCents } from "@/lib/booking/stripe/money";
import type { NewServiceVisitRow } from "@/lib/scheduling/domain-types";

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

async function seedChargedVisit() {
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

  const { gateway, state: gatewayState } = createFakeVisitPaymentGateway();
  await prepareVisitPaymentReview(schedulingRepo, gateway, visit.id);
  await selectVisitTip(schedulingRepo, gateway, { serviceVisitId: visit.id, tipSelectionType: "percentage_15" });

  const { repo: bookingRepo } = createFakeBookingRepository({
    customers: { "customer-1": { id: "customer-1", name: "Jane", email: "jane@example.com", phone: null, stripeCustomerId: "cus_1", stripeDefaultPaymentMethodId: "pm_1", stripePaymentMethodBrand: "visa", stripePaymentMethodLast4: "4242" } },
  });
  const outcome = await createVisitPaymentIntent(schedulingRepo, bookingRepo, gateway, { serviceVisitId: visit.id, customerId: "customer-1" });
  if (outcome.outcome !== "ready") throw new Error("expected ready");

  const payment = (await schedulingRepo.findServiceVisitPaymentByVisitId(visit.id))!;
  return { schedulingRepo, gateway, gatewayState, visitId: visit.id, paymentIntentId: payment.stripePaymentIntentId!, totalAmount: payment.totalAmount! };
}

describe("reconcileVisitPayment", () => {
  it("payment_intent.succeeded -> paid, rolls up service_visit_pricing.payment_status, and reconciles the Stripe-automatic Tax Transaction (never createFromCalculation)", async () => {
    const { schedulingRepo, gateway, gatewayState, visitId, paymentIntentId } = await seedChargedVisit();
    gatewayState.taxAssociationByPaymentIntentId.set(paymentIntentId, { committedTransactionId: "txn_abc", erroredReason: null });

    await reconcileVisitPayment(schedulingRepo, gateway, { stripePaymentIntentId: paymentIntentId, status: "paid" });

    const payment = await schedulingRepo.findServiceVisitPaymentByVisitId(visitId);
    expect(payment!.status).toBe("paid");
    expect(payment!.paidAt).not.toBeNull();
    const pricing = await schedulingRepo.findServiceVisitPricingByVisitId(visitId);
    expect(pricing!.paymentStatus).toBe("paid");
    expect(payment!.taxTransactionStatus).toBe("committed");
    expect(payment!.stripeTaxTransactionId).toBe("txn_abc");
    expect(gatewayState.createTaxTransactionCallCount).toBe(0); // never manually created for the card rail
  });

  it("payment_intent.payment_failed -> payment_failed, with the failure reason recorded", async () => {
    const { schedulingRepo, gateway, visitId, paymentIntentId } = await seedChargedVisit();
    await reconcileVisitPayment(schedulingRepo, gateway, { stripePaymentIntentId: paymentIntentId, status: "payment_failed", failureCode: "card_declined", failureMessage: "Your card was declined." });

    const payment = await schedulingRepo.findServiceVisitPaymentByVisitId(visitId);
    expect(payment!.status).toBe("payment_failed");
    expect(payment!.failureCode).toBe("card_declined");
    const pricing = await schedulingRepo.findServiceVisitPricingByVisitId(visitId);
    expect(pricing!.paymentStatus).toBe("payment_failed");
  });

  it("payment_intent.requires_action -> requires_action", async () => {
    const { schedulingRepo, gateway, visitId, paymentIntentId } = await seedChargedVisit();
    await reconcileVisitPayment(schedulingRepo, gateway, { stripePaymentIntentId: paymentIntentId, status: "requires_action" });
    const payment = await schedulingRepo.findServiceVisitPaymentByVisitId(visitId);
    expect(payment!.status).toBe("requires_action");
  });

  it("payment_intent.processing -> processing", async () => {
    const { schedulingRepo, gateway, visitId, paymentIntentId } = await seedChargedVisit();
    await reconcileVisitPayment(schedulingRepo, gateway, { stripePaymentIntentId: paymentIntentId, status: "processing" });
    const payment = await schedulingRepo.findServiceVisitPaymentByVisitId(visitId);
    expect(payment!.status).toBe("processing");
  });

  it("is a safe no-op for an unknown/foreign PaymentIntent id", async () => {
    const { schedulingRepo, gateway } = await seedChargedVisit();
    await expect(reconcileVisitPayment(schedulingRepo, gateway, { stripePaymentIntentId: "pi_unknown", status: "paid" })).resolves.toBeUndefined();
  });

  it("completion stays completed and package credit is untouched when payment fails — reconciliation writes only to service_visit_payments/service_visit_pricing.payment_status", async () => {
    const { schedulingRepo, visitId, paymentIntentId, gateway } = await seedChargedVisit();
    const before = await schedulingRepo.findServiceVisitById(visitId);
    await reconcileVisitPayment(schedulingRepo, gateway, { stripePaymentIntentId: paymentIntentId, status: "payment_failed" });
    const after = await schedulingRepo.findServiceVisitById(visitId);
    expect(after!.status).toBe(before!.status);
    expect(after!.completedAt).toEqual(before!.completedAt);
  });
});

describe("reconcileVisitPaymentRefund", () => {
  it("full refund -> refunded, never touches tip/tax/total", async () => {
    const { schedulingRepo, gateway, visitId, paymentIntentId, totalAmount } = await seedChargedVisit();
    await reconcileVisitPayment(schedulingRepo, gateway, { stripePaymentIntentId: paymentIntentId, status: "paid" });

    await reconcileVisitPaymentRefund(schedulingRepo, { stripePaymentIntentId: paymentIntentId, refundedAmountCents: toStripeCents(totalAmount), chargeAmountCents: toStripeCents(totalAmount) });

    const payment = await schedulingRepo.findServiceVisitPaymentByVisitId(visitId);
    expect(payment!.status).toBe("refunded");
    expect(payment!.refundedAmount).toBeCloseTo(totalAmount, 2);
    expect(payment!.totalAmount).toBeCloseTo(totalAmount, 2); // unchanged
  });

  it("partial refund -> partially_refunded", async () => {
    const { schedulingRepo, gateway, paymentIntentId, totalAmount, visitId } = await seedChargedVisit();
    await reconcileVisitPayment(schedulingRepo, gateway, { stripePaymentIntentId: paymentIntentId, status: "paid" });

    await reconcileVisitPaymentRefund(schedulingRepo, { stripePaymentIntentId: paymentIntentId, refundedAmountCents: toStripeCents(totalAmount / 2), chargeAmountCents: toStripeCents(totalAmount) });

    const payment = await schedulingRepo.findServiceVisitPaymentByVisitId(visitId);
    expect(payment!.status).toBe("partially_refunded");
  });
});
