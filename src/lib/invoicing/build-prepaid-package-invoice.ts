import type { NewInvoiceInput, NewReceiptInput, PrepaidPackageRow } from "@/lib/scheduling/domain-types";
import { formatCadenceLabel } from "@/lib/admin/format";
import { roundToCents } from "@/lib/pricing/money";

/**
 * Builds the invoice+receipt input pair for a prepaid package purchase
 * (webhook's finalizeVerifiedPayment, on package activation). One invoice
 * for the whole lump-sum package — package_total_paid is the pre-tax
 * principal actually charged at checkout (inclusive of whatever discount/
 * first-cleaning-offer applied at purchase time; this milestone's pricing
 * engine isn't wired into the live booking flow yet, so there is no
 * separate pre-discount baseline to decompose here — see CLAUDE.md).
 * taxAmount is the real Stripe Tax collected on top of it, tracked as its
 * own immutable field (see 20260918100000's migration comment) — never
 * folded into package_total_paid and never recomputed here. Mirrors
 * build-service-visit-invoice.ts's convention: the invoice's subtotal/total
 * exclude tip (packages have none), the receipt's amountPaid is the actual
 * gross settled amount with taxPaid broken out as an "included in
 * amountPaid" line, not an additional charge on top of it.
 *
 * taxAmount/totalAmountPaid are null on packages purchased before this
 * accounting fix existed (or when TAX_MODE was disabled at purchase) — in
 * that legacy case this falls back to treating the whole principal as the
 * total, exactly the (understated but never overstated) behavior this
 * function had before the fix, rather than inventing a tax figure.
 */
export function buildPrepaidPackageInvoiceAndReceipt(params: {
  package: PrepaidPackageRow;
  customerDisplayName: string;
  paymentMethodDisplay: string;
  stripePaymentIntentId: string | null;
}): { invoiceInput: NewInvoiceInput; receiptInput: Omit<NewReceiptInput, "invoiceId"> } {
  const { package: pkg, customerDisplayName, paymentMethodDisplay, stripePaymentIntentId } = params;
  const principal = pkg.packageTotalPaid ?? pkg.effectivePricePerVisit * pkg.purchasedVisitCount;
  const taxAmount = pkg.taxAmount ?? 0;
  const subtotalAmount = principal;
  const totalAmount = roundToCents(subtotalAmount + taxAmount);
  // Prefer the authoritative Stripe-settled amount_total when it was
  // recorded; falls back to subtotal+tax for legacy rows that predate it —
  // the two agree by construction for every package purchased after the
  // tax-accounting fix (see the webhook's own reconciliation check).
  const grossAmountPaid = pkg.totalAmountPaid ?? totalAmount;

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
    baseAmount: principal,
    roomAdjustmentsAmount: 0,
    addOnsAmount: 0,
    addOnsDetail: [],
    travelAmount: 0,
    suppliesAmount: 0,
    discountAmount: 0,
    discountDescription: null,
    cancellationFeeAmount: 0,
    taxAmount,
    subtotalAmount,
    totalAmount,
    pricingSnapshot: null,
  };

  const receiptInput: Omit<NewReceiptInput, "invoiceId"> = {
    customerId: pkg.customerId,
    sourceType: "prepaid_package",
    serviceVisitPaymentId: null,
    serviceFeeAssessmentId: null,
    prepaidPackageId: pkg.id,
    paymentTimestamp: pkg.purchasedAt,
    amountPaid: grossAmountPaid,
    taxPaid: taxAmount,
    tipPaid: 0,
    paymentMethodDisplay,
    stripePaymentIntentId,
    stripeChargeId: null,
    currency: "usd",
  };

  return { invoiceInput, receiptInput };
}
