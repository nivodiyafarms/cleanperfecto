import type { NewInvoiceInput, NewReceiptInput, PrepaidPackageRow } from "@/lib/scheduling/domain-types";
import { formatCadenceLabel } from "@/lib/admin/format";

/**
 * Builds the invoice+receipt input pair for a prepaid package purchase
 * (webhook's finalizeVerifiedPayment, on package activation). One invoice
 * for the whole lump-sum package total — package_total_paid is already the
 * single amount actually charged at checkout, inclusive of whatever
 * discount/first-cleaning-offer applied at purchase time (this milestone's
 * pricing engine isn't wired into the live booking flow yet, so there is no
 * separate pre-discount baseline to decompose here — see CLAUDE.md).
 */
export function buildPrepaidPackageInvoiceAndReceipt(params: {
  package: PrepaidPackageRow;
  customerDisplayName: string;
  paymentMethodDisplay: string;
  stripePaymentIntentId: string | null;
}): { invoiceInput: NewInvoiceInput; receiptInput: Omit<NewReceiptInput, "invoiceId"> } {
  const { package: pkg, customerDisplayName, paymentMethodDisplay, stripePaymentIntentId } = params;
  const amount = pkg.packageTotalPaid ?? pkg.effectivePricePerVisit * pkg.purchasedVisitCount;

  const invoiceInput: NewInvoiceInput = {
    sourceType: "prepaid_package",
    serviceVisitId: null,
    prepaidPackageId: pkg.id,
    serviceVisitPricingId: null,
    serviceFeeAssessmentId: null,
    customerId: pkg.customerId,
    customerDisplayName,
    description: `${pkg.purchasedVisitCount}-Visit Prepaid Cleaning Package (${formatCadenceLabel(pkg.frequency)})`,
    serviceAddressLine1: null,
    serviceAddressLine2: null,
    serviceCity: null,
    serviceState: null,
    serviceZip: null,
    serviceDate: null,
    cleaningType: null,
    currency: "usd",
    baseAmount: amount,
    roomAdjustmentsAmount: 0,
    addOnsAmount: 0,
    addOnsDetail: [],
    travelAmount: 0,
    suppliesAmount: 0,
    discountAmount: 0,
    discountDescription: null,
    cancellationFeeAmount: 0,
    taxAmount: 0,
    subtotalAmount: amount,
    totalAmount: amount,
    pricingSnapshot: null,
  };

  const receiptInput: Omit<NewReceiptInput, "invoiceId"> = {
    customerId: pkg.customerId,
    sourceType: "prepaid_package",
    serviceVisitPaymentId: null,
    serviceFeeAssessmentId: null,
    prepaidPackageId: pkg.id,
    paymentTimestamp: pkg.purchasedAt,
    amountPaid: amount,
    taxPaid: 0,
    tipPaid: 0,
    paymentMethodDisplay,
    stripePaymentIntentId,
    stripeChargeId: null,
    currency: "usd",
  };

  return { invoiceInput, receiptInput };
}
