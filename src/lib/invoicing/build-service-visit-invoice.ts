import type { InvoiceAddOnLine, NewInvoiceInput, NewReceiptInput, ServiceVisitPaymentRow, ServiceVisitPricingRow, ServiceVisitRow } from "@/lib/scheduling/domain-types";
import { classifyAddOns } from "@/lib/pricing/add-ons";
import { resolveTaxLocationAddress } from "@/lib/payments/resolve-tax-location";
import { SERVICES } from "@/lib/services";
import { formatPaymentMethodDisplay } from "./format-payment-method-display";

function cleaningTypeLabel(cleaningType: ServiceVisitRow["cleaningType"]): string {
  if (!cleaningType) return "Cleaning";
  const service = SERVICES.find((s) => s.id === cleaningType);
  return service?.name ?? cleaningType;
}

function toCalendarDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Builds the invoice+receipt input pair for a settled per-visit payment
 * (either rail: stripe_card via reconcile-visit-payment.ts, or zelle/cash
 * via record-external-payment.ts) — both produce the same frozen
 * ServiceVisitPaymentRow shape, so one builder covers both call sites.
 *
 * The invoice deliberately excludes tip (service cost only: subtotal +
 * tax); the receipt's amountPaid is the actual gross settled amount
 * (service + tax + tip), with tipPaid broken out separately — see
 * InvoiceRow's doc comment for why.
 */
export function buildServiceVisitInvoiceAndReceipt(params: {
  visit: ServiceVisitRow;
  pricing: ServiceVisitPricingRow | null;
  customerDisplayName: string;
  payment: ServiceVisitPaymentRow;
}): { invoiceInput: NewInvoiceInput; receiptInput: Omit<NewReceiptInput, "invoiceId"> } {
  const { visit, pricing, customerDisplayName, payment } = params;

  const baseAmount = pricing?.baseAmount ?? 0;
  const addOnsAmount = pricing?.addOnAmount ?? 0;
  const addOnsDetail: InvoiceAddOnLine[] = pricing ? classifyAddOns(pricing.addOnIds).priced : [];
  const taxAmount = payment.taxAmount ?? 0;
  // No room-adjustment/travel/supplies breakdown exists yet on
  // service_visit_pricing today (admin-entered flow, not yet wired to the
  // line-item pricing engine — see CLAUDE.md's "Approved Instant Quote
  // Calculator" note) — these stay 0 rather than an invented split.
  const subtotalAmount = baseAmount + addOnsAmount;
  const totalAmount = subtotalAmount + taxAmount;

  const address = resolveAddressSafely(visit);
  const serviceDate = visit.completedAt ?? visit.confirmedStartAt ?? visit.requestedStartAt;

  const invoiceInput: NewInvoiceInput = {
    sourceType: "service_visit",
    serviceVisitId: visit.id,
    prepaidPackageId: null,
    serviceVisitPricingId: pricing?.id ?? null,
    serviceFeeAssessmentId: null,
    customerId: visit.customerId,
    customerDisplayName,
    description: `${cleaningTypeLabel(visit.cleaningType)}${address ? ` – ${address.city}, ${address.state}` : ""}`,
    serviceAddressLine1: address?.line1 ?? null,
    serviceAddressLine2: address?.line2 ?? null,
    serviceCity: address?.city ?? null,
    serviceState: address?.state ?? null,
    serviceZip: address?.zip ?? null,
    serviceDate: serviceDate ? toCalendarDate(serviceDate) : null,
    cleaningType: visit.cleaningType,
    currency: payment.currency,
    baseAmount,
    roomAdjustmentsAmount: 0,
    addOnsAmount,
    addOnsDetail,
    travelAmount: 0,
    suppliesAmount: 0,
    discountAmount: 0,
    discountDescription: null,
    cancellationFeeAmount: 0,
    taxAmount,
    subtotalAmount,
    totalAmount,
    pricingSnapshot: (pricing?.pricingSnapshot as Record<string, unknown> | null) ?? null,
  };

  const paymentMethodDisplay =
    payment.paymentMethodType === "stripe_card"
      ? formatPaymentMethodDisplay({ rail: "stripe_card", cardBrand: payment.cardBrand, cardLast4: payment.cardLast4 })
      : payment.paymentMethodType === "zelle"
        ? formatPaymentMethodDisplay({ rail: "zelle" })
        : formatPaymentMethodDisplay({ rail: "cash" });

  const receiptInput: Omit<NewReceiptInput, "invoiceId"> = {
    customerId: visit.customerId,
    sourceType: "visit_payment",
    serviceVisitPaymentId: payment.id,
    serviceFeeAssessmentId: null,
    prepaidPackageId: null,
    paymentTimestamp: payment.paidAt ?? new Date(),
    amountPaid: payment.totalAmount ?? totalAmount,
    taxPaid: taxAmount,
    tipPaid: payment.tipAmount ?? 0,
    paymentMethodDisplay,
    stripePaymentIntentId: payment.stripePaymentIntentId,
    stripeChargeId: null,
    currency: payment.currency,
  };

  return { invoiceInput, receiptInput };
}

/** resolveTaxLocationAddress throws when the ZIP can't be resolved — invoice building must never let that abort an already-successful payment, so a resolution failure here just means no address on the invoice, not a thrown error. */
function resolveAddressSafely(visit: ServiceVisitRow): { line1: string | null; line2: string | null; city: string | null; state: string | null; zip: string } | null {
  try {
    return resolveTaxLocationAddress(visit);
  } catch {
    return null;
  }
}
