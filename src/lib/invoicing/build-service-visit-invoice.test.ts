import { describe, expect, it } from "vitest";
import type { ServiceVisitPaymentRow, ServiceVisitPricingRow, ServiceVisitRow } from "@/lib/scheduling/domain-types";
import { buildServiceVisitInvoiceAndReceipt } from "./build-service-visit-invoice";

function baseVisit(overrides: Partial<ServiceVisitRow> = {}): ServiceVisitRow {
  return {
    id: "visit-1",
    customerId: "customer-1",
    quoteRequestId: null,
    bookingOrderId: null,
    prepaidPackageId: null,
    recurringScheduleId: null,
    visitNumber: null,
    cleaningType: "standard",
    frequency: "one_time",
    status: "completed",
    requestedStartAt: null,
    confirmedAt: null,
    confirmedStartAt: null,
    confirmedEndAt: null,
    estimatedLaborMinutes: null,
    estimatedServiceMinutes: null,
    recommendedCleanerCount: null,
    turnaroundBufferMinutes: null,
    timezone: "America/Chicago",
    workFinishedAt: null,
    completedAt: new Date("2026-09-01T15:00:00Z"),
    cancelledAt: null,
    serviceAddressLine1: "123 Main St",
    serviceAddressLine2: null,
    serviceCity: "Frisco",
    serviceState: "TX",
    serviceAddressIdentity: "75056|123 MAIN ST|",
    reviewRequestSuppressed: false,
    ...overrides,
  };
}

function basePricing(overrides: Partial<ServiceVisitPricingRow> = {}): ServiceVisitPricingRow {
  return {
    id: "pricing-1",
    serviceVisitId: "visit-1",
    pricingVersion: "v1",
    pricingSnapshot: {},
    baseAmount: 150,
    addOnIds: [],
    addOnAmount: 0,
    customAdjustments: [],
    customChargeAmount: 0,
    customDiscountAmount: 0,
    totalAmount: 150,
    amountDueFromCustomer: 150,
    priceStatus: "confirmed",
    requiresCustomerApproval: false,
    previouslyApprovedAmount: null,
    paymentStatus: "awaiting_payment",
    confirmedAt: new Date(),
    confirmedBy: "admin:1",
    ...overrides,
  };
}

function basePayment(overrides: Partial<ServiceVisitPaymentRow> = {}): ServiceVisitPaymentRow {
  return {
    id: "payment-1",
    serviceVisitId: "visit-1",
    serviceVisitPricingId: "pricing-1",
    approvedAmount: 150,
    tipBasisAmount: 150,
    tipSelectionType: "percentage_15",
    tipPercentage: 15,
    tipAmount: 22.5,
    taxAmount: 12.38,
    totalAmount: 184.88,
    tipSelectedAt: new Date(),
    tipConfirmedAt: new Date(),
    taxLocationSnapshot: null,
    currency: "usd",
    paymentMethodType: "stripe_card",
    stripeCustomerId: "cus_1",
    stripePaymentMethodId: "pm_1",
    cardBrand: "visa",
    cardLast4: "4242",
    stripePaymentIntentId: "pi_1",
    stripeTaxCalculationId: "taxcalc_1",
    taxCalculationExpiresAt: null,
    taxTransactionStatus: "committed",
    stripeTaxTransactionId: "taxtxn_1",
    taxTransactionFailureCode: null,
    taxTransactionFailureMessage: null,
    taxTransactionLastAttemptAt: null,
    externalPaymentReference: null,
    status: "paid",
    idempotencyKey: "idem-1",
    failureCode: null,
    failureMessage: null,
    refundedAmount: 0,
    refundedAt: null,
    paidAt: new Date("2026-09-01T16:00:00Z"),
    createdAt: new Date("2026-09-01T15:30:00Z"),
    updatedAt: new Date("2026-09-01T16:00:00Z"),
    ...overrides,
  };
}

describe("buildServiceVisitInvoiceAndReceipt — custom charges and discounts/credits", () => {
  it("includes a custom charge as a positive line item and adds it into the subtotal", () => {
    const pricing = basePricing({
      customChargeAmount: 45,
      customAdjustments: [
        { id: "adj-1", type: "custom_charge", description: "Extra garage clean", amount: 45, addedByAdminUserId: "admin:1", addedByRole: "operations", addedAt: new Date() },
      ],
    });
    const { invoiceInput } = buildServiceVisitInvoiceAndReceipt({
      visit: baseVisit(),
      pricing,
      customerDisplayName: "Jane Doe",
      payment: basePayment({ taxAmount: 0 }),
    });

    expect(invoiceInput.customChargesAmount).toBe(45);
    expect(invoiceInput.customChargesDetail).toEqual([{ description: "Extra garage clean", amount: 45 }]);
    expect(invoiceInput.subtotalAmount).toBe(150 + 45);
    expect(invoiceInput.totalAmount).toBe(150 + 45);
  });

  it("includes a custom discount/credit as a negative line item, reducing the subtotal", () => {
    const pricing = basePricing({
      customDiscountAmount: 25,
      customAdjustments: [
        { id: "adj-1", type: "custom_discount", description: "Loyalty credit", amount: 25, addedByAdminUserId: "owner:1", addedByRole: "owner_admin", addedAt: new Date() },
      ],
    });
    const { invoiceInput } = buildServiceVisitInvoiceAndReceipt({
      visit: baseVisit(),
      pricing,
      customerDisplayName: "Jane Doe",
      payment: basePayment({ taxAmount: 0 }),
    });

    expect(invoiceInput.discountAmount).toBe(25);
    expect(invoiceInput.discountDetail).toEqual([{ description: "Loyalty credit", amount: 25 }]);
    expect(invoiceInput.subtotalAmount).toBe(150 - 25);
  });

  it("combines a custom charge and discount together in the subtotal, each as its own separate line item", () => {
    const pricing = basePricing({
      customChargeAmount: 45,
      customDiscountAmount: 25,
      customAdjustments: [
        { id: "adj-1", type: "custom_charge", description: "Extra garage clean", amount: 45, addedByAdminUserId: "admin:1", addedByRole: "operations", addedAt: new Date() },
        { id: "adj-2", type: "custom_discount", description: "Loyalty credit", amount: 25, addedByAdminUserId: "owner:1", addedByRole: "owner_admin", addedAt: new Date() },
      ],
    });
    const { invoiceInput } = buildServiceVisitInvoiceAndReceipt({
      visit: baseVisit(),
      pricing,
      customerDisplayName: "Jane Doe",
      payment: basePayment({ taxAmount: 0 }),
    });

    expect(invoiceInput.customChargesDetail).toHaveLength(1);
    expect(invoiceInput.discountDetail).toHaveLength(1);
    expect(invoiceInput.subtotalAmount).toBe(150 + 45 - 25);
  });

  it("multiple custom charges each appear as their own line item and all sum into the total", () => {
    const pricing = basePricing({
      customChargeAmount: 60,
      customAdjustments: [
        { id: "adj-1", type: "custom_charge", description: "First extra", amount: 45, addedByAdminUserId: "admin:1", addedByRole: "operations", addedAt: new Date() },
        { id: "adj-2", type: "custom_charge", description: "Second extra", amount: 15, addedByAdminUserId: "admin:1", addedByRole: "operations", addedAt: new Date() },
      ],
    });
    const { invoiceInput } = buildServiceVisitInvoiceAndReceipt({
      visit: baseVisit(),
      pricing,
      customerDisplayName: "Jane Doe",
      payment: basePayment({ taxAmount: 0 }),
    });

    expect(invoiceInput.customChargesDetail).toEqual([
      { description: "First extra", amount: 45 },
      { description: "Second extra", amount: 15 },
    ]);
    expect(invoiceInput.subtotalAmount).toBe(150 + 60);
  });

  it("tax is applied on top of the adjusted subtotal and tip is never part of the invoice total", () => {
    const pricing = basePricing({
      customChargeAmount: 45,
      customDiscountAmount: 25,
      customAdjustments: [
        { id: "adj-1", type: "custom_charge", description: "Extra", amount: 45, addedByAdminUserId: "admin:1", addedByRole: "operations", addedAt: new Date() },
        { id: "adj-2", type: "custom_discount", description: "Credit", amount: 25, addedByAdminUserId: "owner:1", addedByRole: "owner_admin", addedAt: new Date() },
      ],
    });
    const payment = basePayment({ taxAmount: 14.03, tipAmount: 30, totalAmount: 214.03 });
    const { invoiceInput, receiptInput } = buildServiceVisitInvoiceAndReceipt({
      visit: baseVisit(),
      pricing,
      customerDisplayName: "Jane Doe",
      payment,
    });

    // subtotal (150 + 45 - 25 = 170) is the taxable basis Stripe Tax computed against — never recomputed here.
    expect(invoiceInput.subtotalAmount).toBe(170);
    expect(invoiceInput.taxAmount).toBe(14.03);
    expect(invoiceInput.totalAmount).toBe(170 + 14.03);
    // Tip is on the receipt, broken out separately, and never folded into the invoice total.
    expect(receiptInput.tipPaid).toBe(30);
    expect(receiptInput.amountPaid).toBe(214.03);
  });

  it("existing predefined add-ons continue to combine with a custom charge unchanged", () => {
    const pricing = basePricing({
      addOnIds: ["inside_oven"],
      addOnAmount: 30,
      customChargeAmount: 20,
      customAdjustments: [
        { id: "adj-1", type: "custom_charge", description: "Extra", amount: 20, addedByAdminUserId: "admin:1", addedByRole: "operations", addedAt: new Date() },
      ],
    });
    const { invoiceInput } = buildServiceVisitInvoiceAndReceipt({
      visit: baseVisit(),
      pricing,
      customerDisplayName: "Jane Doe",
      payment: basePayment({ taxAmount: 0 }),
    });

    expect(invoiceInput.addOnsAmount).toBe(30);
    expect(invoiceInput.addOnsDetail).toHaveLength(1);
    expect(invoiceInput.subtotalAmount).toBe(150 + 30 + 20);
  });

  it("with no pricing row at all, custom charge/discount fields default to zero/empty rather than throwing", () => {
    const { invoiceInput } = buildServiceVisitInvoiceAndReceipt({
      visit: baseVisit(),
      pricing: null,
      customerDisplayName: "Jane Doe",
      payment: basePayment({ approvedAmount: 0, taxAmount: 0, totalAmount: 0 }),
    });

    expect(invoiceInput.customChargesAmount).toBe(0);
    expect(invoiceInput.customChargesDetail).toEqual([]);
    expect(invoiceInput.discountAmount).toBe(0);
    expect(invoiceInput.discountDetail).toEqual([]);
  });
});
