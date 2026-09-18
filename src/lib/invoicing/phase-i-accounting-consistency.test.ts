import { describe, expect, it } from "vitest";
import { createFakeSchedulingRepository } from "@/lib/scheduling/test-support/fake-scheduling-repository";
import { createFakeVisitPaymentGateway } from "@/lib/payments/test-support/fake-visit-payment-gateway";
import { prepareVisitPaymentReview } from "@/lib/payments/prepare-visit-payment-review";
import { selectVisitTip } from "@/lib/payments/select-visit-tip";
import { createVisitPaymentIntent } from "@/lib/payments/create-visit-payment-intent";
import { createFakeBookingRepository } from "@/lib/booking/test-support/fake-booking-repository";
import { reconcileVisitPayment, reconcileVisitPaymentRefund } from "@/lib/payments/reconcile-visit-payment";
import { collectServiceFeeExternally } from "@/lib/payments/collect-service-fee";
import { issueDocumentsForPackagePurchase } from "./issue-documents-for-package-purchase";
import { getReceiptRefundStatus } from "./get-receipt-refund-status";
import type { NewServiceVisitRow, PrepaidPackageRow, ServiceFeeAssessmentRow } from "@/lib/scheduling/domain-types";

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
    addOnIds: ["inside_oven"],
    addOnAmount: 30,
    totalAmount: 209,
    amountDueFromCustomer: 209,
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
    customers: { "customer-1": { id: "customer-1", name: "Jane Doe", email: "jane@example.com", phone: null, stripeCustomerId: "cus_1", stripeDefaultPaymentMethodId: "pm_1", stripePaymentMethodBrand: "visa", stripePaymentMethodLast4: "4242" } },
  });
  const outcome = await createVisitPaymentIntent(schedulingRepo, bookingRepo, gateway, { serviceVisitId: visit.id, customerId: "customer-1" });
  if (outcome.outcome !== "ready") throw new Error("expected ready");

  const payment = (await schedulingRepo.findServiceVisitPaymentByVisitId(visit.id))!;
  return { schedulingRepo, state, gateway, visitId: visit.id, paymentIntentId: payment.stripePaymentIntentId! };
}

describe("Phase I — end-to-end accounting consistency", () => {
  it("normal paid visit: invoice -> payment -> receipt, invoice excludes tip, receipt includes it", async () => {
    const { schedulingRepo, state, gateway, visitId, paymentIntentId } = await seedChargedVisit();

    await reconcileVisitPayment(schedulingRepo, gateway, { stripePaymentIntentId: paymentIntentId, status: "paid" });

    const payment = (await schedulingRepo.findServiceVisitPaymentByVisitId(visitId))!;
    const invoices = [...state.invoicesById.values()].filter((i) => i.serviceVisitId === visitId);
    const receipts = [...state.receiptsById.values()].filter((r) => r.serviceVisitPaymentId === payment.id);

    expect(invoices).toHaveLength(1);
    expect(receipts).toHaveLength(1);

    const invoice = invoices[0];
    const receipt = receipts[0];

    expect(invoice.invoiceNumber).toMatch(/^CP-INV-\d{4}-\d{6}$/);
    expect(receipt.receiptNumber).toMatch(/^CP-RCT-\d{4}-\d{6}$/);
    expect(receipt.invoiceId).toBe(invoice.id);

    // Invoice = service cost only (base + add-ons + tax), never tip.
    expect(invoice.baseAmount).toBe(179);
    expect(invoice.addOnsAmount).toBe(30);
    expect(invoice.taxAmount).toBe(payment.taxAmount ?? 0);
    expect(invoice.totalAmount).toBeCloseTo(179 + 30 + (payment.taxAmount ?? 0), 2);
    expect(invoice.paymentStatus).toBe("paid");

    // Receipt = actual gross settled amount, tip broken out separately.
    expect(receipt.amountPaid).toBe(payment.totalAmount);
    expect(receipt.tipPaid).toBe(payment.tipAmount);
    expect(receipt.tipPaid).toBeGreaterThan(0);
    expect(receipt.amountPaid).toBeGreaterThan(invoice.totalAmount); // gross paid > invoice total because of tip
  });

  it("does not issue a second invoice/receipt on a duplicate/redelivered payment_intent.succeeded", async () => {
    const { schedulingRepo, state, gateway, visitId, paymentIntentId } = await seedChargedVisit();

    await reconcileVisitPayment(schedulingRepo, gateway, { stripePaymentIntentId: paymentIntentId, status: "paid" });
    await reconcileVisitPayment(schedulingRepo, gateway, { stripePaymentIntentId: paymentIntentId, status: "paid" }); // redelivery

    const invoices = [...state.invoicesById.values()].filter((i) => i.serviceVisitId === visitId);
    expect(invoices).toHaveLength(1);
  });

  it("partial refund: original invoice and receipt facts are preserved; live refund status reflects the new refund separately", async () => {
    const { schedulingRepo, state, gateway, visitId, paymentIntentId } = await seedChargedVisit();
    await reconcileVisitPayment(schedulingRepo, gateway, { stripePaymentIntentId: paymentIntentId, status: "paid" });

    const invoiceBefore = [...state.invoicesById.values()].find((i) => i.serviceVisitId === visitId)!;
    const payment = (await schedulingRepo.findServiceVisitPaymentByVisitId(visitId))!;
    const receipt = [...state.receiptsById.values()].find((r) => r.serviceVisitPaymentId === payment.id)!;
    const originalAmountPaid = receipt.amountPaid;
    const originalTotal = invoiceBefore.totalAmount;

    const partialRefundCents = Math.round((payment.totalAmount ?? 0) * 50); // 50% of total, in cents
    await reconcileVisitPaymentRefund(schedulingRepo, {
      stripePaymentIntentId: paymentIntentId,
      refundedAmountCents: partialRefundCents,
      chargeAmountCents: Math.round((payment.totalAmount ?? 0) * 100),
    });

    // Original historical facts: untouched.
    const invoiceAfter = await schedulingRepo.findInvoiceById(invoiceBefore.id);
    const receiptAfter = await schedulingRepo.findReceiptById(receipt.id);
    expect(invoiceAfter!.totalAmount).toBe(originalTotal);
    expect(invoiceAfter!.paymentStatus).toBe("paid");
    expect(receiptAfter!.amountPaid).toBe(originalAmountPaid);

    // Refund is reflected separately via the live join, never by rewriting the receipt.
    const status = await getReceiptRefundStatus(schedulingRepo, receiptAfter!);
    expect(status.refundStatus).toBe("partial");
    expect(status.refundedAmount).toBeCloseTo(partialRefundCents / 100, 2);
    expect(status.netAmountPaid).toBeCloseTo(originalAmountPaid - partialRefundCents / 100, 2);
  });

  it("full refund: same historical preservation, refund status reports 'full'", async () => {
    const { schedulingRepo, state, gateway, visitId, paymentIntentId } = await seedChargedVisit();
    await reconcileVisitPayment(schedulingRepo, gateway, { stripePaymentIntentId: paymentIntentId, status: "paid" });

    const invoiceBefore = [...state.invoicesById.values()].find((i) => i.serviceVisitId === visitId)!;
    const payment = (await schedulingRepo.findServiceVisitPaymentByVisitId(visitId))!;
    const receipt = [...state.receiptsById.values()].find((r) => r.serviceVisitPaymentId === payment.id)!;
    const totalCents = Math.round((payment.totalAmount ?? 0) * 100);

    await reconcileVisitPaymentRefund(schedulingRepo, { stripePaymentIntentId: paymentIntentId, refundedAmountCents: totalCents, chargeAmountCents: totalCents });

    const invoiceAfter = await schedulingRepo.findInvoiceById(invoiceBefore.id);
    expect(invoiceAfter!.totalAmount).toBe(invoiceBefore.totalAmount);
    expect(invoiceAfter!.paymentStatus).toBe("paid"); // invoice fact is never rewritten to "unpaid"/"refunded"

    const status = await getReceiptRefundStatus(schedulingRepo, receipt);
    expect(status.refundStatus).toBe("full");
    expect(status.netAmountPaid).toBeCloseTo(0, 2);
  });

  it("cancellation fee: separate assessment/collection represented correctly, independent of any visit payment", async () => {
    const { schedulingRepo, state, visitId } = await seedChargedVisit();

    const feeAssessment: ServiceFeeAssessmentRow = {
      id: "fee-1",
      serviceVisitId: visitId,
      feeType: "cancellation",
      amount: 50,
      policyVersion: "v1",
      reason: null,
      state: "assessed",
    };
    state.feeAssessments.push(feeAssessment);

    const collected = await collectServiceFeeExternally(schedulingRepo, {
      feeAssessmentId: "fee-1",
      collectionMethod: "zelle",
      externalPaymentReference: "ZL-1",
      actorAdminUserId: "admin-1",
      actorRole: "owner_admin",
    });
    expect(collected.state).toBe("paid");

    const invoice = [...state.invoicesById.values()].find((i) => i.serviceFeeAssessmentId === "fee-1")!;
    const receipt = [...state.receiptsById.values()].find((r) => r.serviceFeeAssessmentId === "fee-1")!;

    expect(invoice.cancellationFeeAmount).toBe(50);
    expect(invoice.totalAmount).toBe(50);
    expect(invoice.serviceVisitPricingId).toBeNull();
    expect(receipt.amountPaid).toBe(50);
    expect(receipt.sourceType).toBe("cancellation_fee");
    expect(receipt.serviceVisitPaymentId).toBeNull();

    // Never netted against the visit's own cleaning charge.
    const visitPayment = await schedulingRepo.findServiceVisitPaymentByVisitId(visitId);
    expect(visitPayment!.status).not.toBe("paid"); // the visit's own payment was never touched by this fee collection
  });

  it("prepaid package: package payment/refund represented correctly as a single lump-sum invoice+receipt", async () => {
    const { repo: schedulingRepo, state } = createFakeSchedulingRepository();
    const pkg: PrepaidPackageRow = {
      id: "pkg-1",
      customerId: "customer-1",
      bookingOrderId: "booking-1",
      frequency: "weekly",
      purchasedVisitCount: 6,
      remainingVisitCount: 6,
      packageTotalPaid: 900,
      effectivePricePerVisit: 150,
      status: "active",
      purchasedAt: new Date(),
    };
    state.prepaidPackagesById.set(pkg.id, pkg);

    const { invoice, receipt } = await issueDocumentsForPackagePurchase(schedulingRepo, pkg, "Visa •••• 4242", "pi_pkg_1");

    expect(invoice.sourceType).toBe("prepaid_package");
    expect(invoice.prepaidPackageId).toBe("pkg-1");
    expect(invoice.totalAmount).toBe(900);
    expect(receipt.amountPaid).toBe(900);
    expect(receipt.sourceType).toBe("prepaid_package");

    // Package refund is a separate, later fact — never rewrites the original invoice/receipt.
    state.prepaidPackagesById.set(pkg.id, { ...pkg, refundedAmount: 300, refundedAt: new Date(), cancelledAt: new Date() });
    const status = await getReceiptRefundStatus(schedulingRepo, receipt);
    expect(status.refundStatus).toBe("partial");
    expect(status.refundedAmount).toBe(300);
    expect((await schedulingRepo.findInvoiceById(invoice.id))!.totalAmount).toBe(900); // untouched
  });

  it("prepaid package WITH Stripe Tax: invoice and receipt show principal, tax, and total separately — total exactly matches what Stripe charged", async () => {
    const { repo: schedulingRepo, state } = createFakeSchedulingRepository();
    const pkg: PrepaidPackageRow = {
      id: "pkg-tax-1",
      customerId: "customer-1",
      bookingOrderId: "booking-tax-1",
      frequency: "weekly",
      purchasedVisitCount: 6,
      remainingVisitCount: 6,
      packageTotalPaid: 900,
      taxAmount: 74.25,
      totalAmountPaid: 974.25,
      stripeTaxTransactionId: "txn_pkg_tax_1",
      effectivePricePerVisit: 150,
      status: "active",
      purchasedAt: new Date(),
    };
    state.prepaidPackagesById.set(pkg.id, pkg);

    const { invoice, receipt } = await issueDocumentsForPackagePurchase(schedulingRepo, pkg, "Visa •••• 4242", "pi_pkg_tax_1");

    // Invoice: subtotal (principal) + tax shown separately, total = principal + tax.
    expect(invoice.baseAmount).toBe(900);
    expect(invoice.subtotalAmount).toBe(900);
    expect(invoice.taxAmount).toBe(74.25);
    expect(invoice.totalAmount).toBe(974.25);

    // Receipt: amountPaid is the actual gross settled amount (matches Stripe's amount_total exactly), tax broken out as included.
    expect(receipt.amountPaid).toBe(974.25);
    expect(receipt.taxPaid).toBe(74.25);
    expect(receipt.tipPaid).toBe(0);

    // Package principal (used for refund math) is never contaminated by tax.
    expect(pkg.packageTotalPaid).toBe(900);
  });

  it("prepaid package with tax_amount/total_amount_paid never recorded (legacy row): falls back to principal-only, never invents a tax figure", async () => {
    const { repo: schedulingRepo, state } = createFakeSchedulingRepository();
    const pkg: PrepaidPackageRow = {
      id: "pkg-legacy-1",
      customerId: "customer-1",
      bookingOrderId: "booking-legacy-1",
      frequency: "weekly",
      purchasedVisitCount: 6,
      remainingVisitCount: 6,
      packageTotalPaid: 900,
      // taxAmount / totalAmountPaid intentionally omitted — legacy row shape.
      effectivePricePerVisit: 150,
      status: "active",
      purchasedAt: new Date(),
    };
    state.prepaidPackagesById.set(pkg.id, pkg);

    const { invoice, receipt } = await issueDocumentsForPackagePurchase(schedulingRepo, pkg, "Visa •••• 4242", "pi_pkg_legacy_1");

    expect(invoice.taxAmount).toBe(0);
    expect(invoice.totalAmount).toBe(900);
    expect(receipt.amountPaid).toBe(900);
    expect(receipt.taxPaid).toBe(0);
  });

  it("dispute: does not rewrite the invoice as unpaid/refunded", async () => {
    const { schedulingRepo, state, gateway, visitId, paymentIntentId } = await seedChargedVisit();
    await reconcileVisitPayment(schedulingRepo, gateway, { stripePaymentIntentId: paymentIntentId, status: "paid" });
    const invoice = [...state.invoicesById.values()].find((i) => i.serviceVisitId === visitId)!;

    await schedulingRepo.upsertStripeDisputeEvent({
      stripeDisputeId: "dp_1",
      stripeChargeId: "ch_1",
      stripePaymentIntentId: paymentIntentId,
      amount: invoice.totalAmount,
      currency: "usd",
      disputeStatus: "needs_response",
      reason: "fraudulent",
      stripeCreatedAt: new Date(),
      stripeEventId: "evt_1",
      stripeEventCreatedAt: new Date(),
      isClosed: false,
    });

    const invoiceAfter = await schedulingRepo.findInvoiceById(invoice.id);
    expect(invoiceAfter!.paymentStatus).toBe("paid");
    expect(invoiceAfter!.totalAmount).toBe(invoice.totalAmount);
  });

  it("void: voiding an invoice is idempotent and writes exactly one audit row", async () => {
    const { repo: schedulingRepo, state } = createFakeSchedulingRepository();
    const invoice = await schedulingRepo.issueInvoice({
      sourceType: "service_visit",
      serviceVisitId: "visit-1",
      prepaidPackageId: null,
      serviceVisitPricingId: null,
      serviceFeeAssessmentId: null,
      customerId: "customer-1",
      customerDisplayName: "Jane Doe",
      description: "Standard Cleaning",
      serviceAddressLine1: null,
      serviceAddressLine2: null,
      serviceCity: null,
      serviceState: null,
      serviceZip: null,
      serviceDate: null,
      cleaningType: "standard",
      currency: "usd",
      baseAmount: 100,
      roomAdjustmentsAmount: 0,
      addOnsAmount: 0,
      addOnsDetail: [],
      travelAmount: 0,
      suppliesAmount: 0,
      discountAmount: 0,
      discountDescription: null,
      cancellationFeeAmount: 0,
      taxAmount: 0,
      subtotalAmount: 100,
      totalAmount: 100,
      pricingSnapshot: null,
    });

    const voided1 = await schedulingRepo.voidInvoiceWithAudit(invoice.id, "Billed in error", { actorAdminUserId: "admin-1", actorRole: "owner_admin" });
    const voided2 = await schedulingRepo.voidInvoiceWithAudit(invoice.id, "Billed in error", { actorAdminUserId: "admin-1", actorRole: "owner_admin" });

    expect(voided1.paymentStatus).toBe("void");
    expect(voided2.voidAt).toEqual(voided1.voidAt); // idempotent no-op on the second call
    expect(state.financialAuditLog.filter((r) => r.actionType === "invoice_voided")).toHaveLength(1);
    // Voiding never rewrites the frozen fact columns.
    expect(voided1.totalAmount).toBe(100);
  });

  it("invoice/receipt numbering is unique under many concurrent issuances (same year)", async () => {
    const { repo: schedulingRepo } = createFakeSchedulingRepository();
    const baseInput = {
      sourceType: "service_visit" as const,
      serviceVisitId: "visit-x",
      prepaidPackageId: null,
      serviceVisitPricingId: null,
      serviceFeeAssessmentId: null,
      customerId: "customer-1",
      customerDisplayName: "Jane Doe",
      description: "Standard Cleaning",
      serviceAddressLine1: null,
      serviceAddressLine2: null,
      serviceCity: null,
      serviceState: null,
      serviceZip: null,
      serviceDate: null,
      cleaningType: "standard" as const,
      currency: "usd",
      baseAmount: 100,
      roomAdjustmentsAmount: 0,
      addOnsAmount: 0,
      addOnsDetail: [],
      travelAmount: 0,
      suppliesAmount: 0,
      discountAmount: 0,
      discountDescription: null,
      cancellationFeeAmount: 0,
      taxAmount: 0,
      subtotalAmount: 100,
      totalAmount: 100,
      pricingSnapshot: null,
    };

    const invoices = await Promise.all(Array.from({ length: 50 }, () => schedulingRepo.issueInvoice(baseInput)));
    const numbers = new Set(invoices.map((i) => i.invoiceNumber));
    expect(numbers.size).toBe(50); // no two concurrent issuances ever collide
  });
});
