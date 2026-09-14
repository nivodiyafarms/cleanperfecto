import type { NewInvoiceInput, NewReceiptInput, ServiceFeeAssessmentRow, ServiceVisitRow } from "@/lib/scheduling/domain-types";
import { formatPaymentMethodDisplay } from "./format-payment-method-display";

const FEE_TYPE_LABEL: Record<ServiceFeeAssessmentRow["feeType"], string> = {
  reschedule: "Reschedule Fee",
  cancellation: "Cancellation Fee",
  no_access: "No-Access Fee",
};

/**
 * Builds the invoice+receipt input pair for an externally-collected
 * cancellation/reschedule/no-access fee (collect-service-fee.ts) —
 * deliberately independent of any service_visit_payments row: a
 * cancellation fee is its own financial fact, never netted against a
 * visit's own cleaning charge (Phase G/H policy).
 */
export function buildCancellationFeeInvoiceAndReceipt(params: {
  visit: ServiceVisitRow;
  customerDisplayName: string;
  feeAssessment: ServiceFeeAssessmentRow;
}): { invoiceInput: NewInvoiceInput; receiptInput: Omit<NewReceiptInput, "invoiceId"> } {
  const { visit, customerDisplayName, feeAssessment } = params;
  const amount = feeAssessment.amount;
  const label = FEE_TYPE_LABEL[feeAssessment.feeType];

  const invoiceInput: NewInvoiceInput = {
    sourceType: "service_visit",
    serviceVisitId: visit.id,
    prepaidPackageId: null,
    serviceVisitPricingId: null,
    serviceFeeAssessmentId: feeAssessment.id,
    customerId: visit.customerId,
    customerDisplayName,
    description: label,
    serviceAddressLine1: visit.serviceAddressLine1,
    serviceAddressLine2: visit.serviceAddressLine2,
    serviceCity: visit.serviceCity,
    serviceState: visit.serviceState,
    serviceZip: null,
    serviceDate: null,
    cleaningType: visit.cleaningType,
    currency: "usd",
    baseAmount: 0,
    roomAdjustmentsAmount: 0,
    addOnsAmount: 0,
    addOnsDetail: [],
    travelAmount: 0,
    suppliesAmount: 0,
    discountAmount: 0,
    discountDescription: null,
    cancellationFeeAmount: amount,
    taxAmount: 0,
    subtotalAmount: amount,
    totalAmount: amount,
    pricingSnapshot: null,
  };

  const paymentMethodDisplay =
    feeAssessment.collectionMethod === "cash" ? formatPaymentMethodDisplay({ rail: "cash" }) : formatPaymentMethodDisplay({ rail: "zelle" });

  const receiptInput: Omit<NewReceiptInput, "invoiceId"> = {
    customerId: visit.customerId,
    sourceType: "cancellation_fee",
    serviceVisitPaymentId: null,
    serviceFeeAssessmentId: feeAssessment.id,
    prepaidPackageId: null,
    paymentTimestamp: feeAssessment.collectedAt ?? new Date(),
    amountPaid: amount,
    taxPaid: 0,
    tipPaid: 0,
    paymentMethodDisplay,
    stripePaymentIntentId: feeAssessment.stripePaymentIntentId ?? null,
    stripeChargeId: null,
    currency: "usd",
  };

  return { invoiceInput, receiptInput };
}
