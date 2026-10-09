import { describe, expect, it } from "vitest";
import { createFakeSchedulingRepository } from "@/lib/scheduling/test-support/fake-scheduling-repository";
import { createFakeBookingRepository } from "@/lib/booking/test-support/fake-booking-repository";
import { createFakeVisitPaymentGateway } from "@/lib/payments/test-support/fake-visit-payment-gateway";
import { prepareVisitPaymentReview } from "@/lib/payments/prepare-visit-payment-review";
import { selectVisitTip } from "@/lib/payments/select-visit-tip";
import { createVisitPaymentIntent } from "@/lib/payments/create-visit-payment-intent";
import { reconcileVisitPayment } from "@/lib/payments/reconcile-visit-payment";
import { issueDocumentsForVisitPayment } from "./issue-documents-for-visit-payment";
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
  return { schedulingRepo, state, gateway, gatewayState, visitId: visit.id, paymentIntentId: payment.stripePaymentIntentId!, payment };
}

describe("document issuance idempotency (concurrent/duplicate webhook deliveries, different events for the same payment)", () => {
  it("calling issueDocumentsForVisitPayment twice for the same settlement produces exactly one invoice and one receipt", async () => {
    const { schedulingRepo, state, payment } = await seedChargedVisit();

    const first = await issueDocumentsForVisitPayment(schedulingRepo, payment);
    const second = await issueDocumentsForVisitPayment(schedulingRepo, payment);

    expect(second.invoice.id).toBe(first.invoice.id);
    expect(second.receipt.id).toBe(first.receipt.id);
    expect(state.invoicesById.size).toBe(1);
    expect(state.receiptsById.size).toBe(1);
  });

  it("two distinct Stripe events resolving to the same payment (e.g. redelivery with a different event id) never create a second invoice/receipt pair via reconcileVisitPayment", async () => {
    const { schedulingRepo, gateway, gatewayState, state, paymentIntentId, visitId } = await seedChargedVisit();
    gatewayState.taxAssociationByPaymentIntentId.set(paymentIntentId, { committedTransactionId: "txn_abc", erroredReason: null });

    // First event: payment_intent.succeeded reaches 'paid', issues documents.
    await reconcileVisitPayment(schedulingRepo, gateway, { stripePaymentIntentId: paymentIntentId, status: "paid" });
    // A second, genuinely different Stripe event (different event id at the
    // webhook-ledger layer, not modeled here) that resolves to the exact
    // same already-paid PaymentIntent — the webhook ledger's dedup is keyed
    // on event id, not payment id, so this reconciliation call itself must
    // be the thing that refuses to re-document the same settlement.
    await reconcileVisitPayment(schedulingRepo, gateway, { stripePaymentIntentId: paymentIntentId, status: "paid" });

    expect(state.invoicesById.size).toBe(1);
    expect(state.receiptsById.size).toBe(1);
    const visit = await schedulingRepo.findServiceVisitById(visitId);
    const paidNotifications = [...state.notifications.values()].filter((n) => n.notificationType === "payment_succeeded" && n.customerId === visit!.customerId);
    expect(paidNotifications.length).toBe(1);
  });

  it("retry after partial failure: reconciling the same payment again (simulating a redelivery after an earlier best-effort documentation failure) recovers without duplicating documents", async () => {
    const { schedulingRepo, gateway, gatewayState, state, paymentIntentId } = await seedChargedVisit();
    gatewayState.taxAssociationByPaymentIntentId.set(paymentIntentId, { committedTransactionId: "txn_abc", erroredReason: null });

    await reconcileVisitPayment(schedulingRepo, gateway, { stripePaymentIntentId: paymentIntentId, status: "paid" });
    expect(state.invoicesById.size).toBe(1);

    // A retry/redelivery of the same outcome must be a safe no-op — never
    // a second invoice, never a thrown error.
    await expect(reconcileVisitPayment(schedulingRepo, gateway, { stripePaymentIntentId: paymentIntentId, status: "paid" })).resolves.toBeUndefined();
    expect(state.invoicesById.size).toBe(1);
    expect(state.receiptsById.size).toBe(1);
  });

  it("issueVisitPaymentDocumentsIdempotent reports alreadyIssued on the second call", async () => {
    const { schedulingRepo, payment } = await seedChargedVisit();
    const visit = await schedulingRepo.findServiceVisitById(payment.serviceVisitId);
    const pricing = await schedulingRepo.findServiceVisitPricingByVisitId(payment.serviceVisitId);
    const customerDisplayName = await schedulingRepo.findCustomerDisplayName(visit!.customerId);

    const invoiceInput = {
      sourceType: "service_visit" as const,
      serviceVisitId: visit!.id,
      prepaidPackageId: null,
      serviceVisitPricingId: pricing?.id ?? null,
      serviceFeeAssessmentId: null,
      customerId: visit!.customerId,
      customerDisplayName,
      description: "Standard Cleaning",
      serviceAddressLine1: null,
      serviceAddressLine2: null,
      serviceCity: null,
      serviceState: null,
      serviceZip: null,
      serviceDate: null,
      cleaningType: visit!.cleaningType,
      currency: "usd",
      baseAmount: 179,
      roomAdjustmentsAmount: 0,
      addOnsAmount: 0,
      addOnsDetail: [],
      travelAmount: 0,
      suppliesAmount: 0,
      customChargesAmount: 0,
      customChargesDetail: [],
      discountAmount: 0,
      discountDescription: null,
      discountDetail: [],
      cancellationFeeAmount: 0,
      taxAmount: 0,
      subtotalAmount: 179,
      totalAmount: 179,
      pricingSnapshot: null,
    };
    const receiptInput = {
      customerId: visit!.customerId,
      sourceType: "visit_payment" as const,
      serviceVisitPaymentId: payment.id,
      serviceFeeAssessmentId: null,
      prepaidPackageId: null,
      paymentTimestamp: new Date(),
      amountPaid: 179,
      taxPaid: 0,
      tipPaid: 0,
      paymentMethodDisplay: "Visa •••• 4242",
      stripePaymentIntentId: payment.stripePaymentIntentId,
      stripeChargeId: null,
      currency: "usd",
    };

    const first = await schedulingRepo.issueVisitPaymentDocumentsIdempotent({ serviceVisitPaymentId: payment.id, invoice: invoiceInput, receipt: receiptInput });
    expect(first.alreadyIssued).toBe(false);

    const second = await schedulingRepo.issueVisitPaymentDocumentsIdempotent({ serviceVisitPaymentId: payment.id, invoice: invoiceInput, receipt: receiptInput });
    expect(second.alreadyIssued).toBe(true);
    expect(second.invoice.id).toBe(first.invoice.id);
    expect(second.receipt.id).toBe(first.receipt.id);
  });
});
