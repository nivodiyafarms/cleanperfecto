import { toStripeCents } from "@/lib/booking/stripe/money";
import type { ServiceVisitPricingRow, ServiceVisitRow } from "@/lib/scheduling/domain-types";
import { resolveTaxLocationAddress } from "./resolve-tax-location";
import type { VisitPaymentGateway } from "./visit-payment-gateway";

export interface ServiceAmountAndTaxPreview {
  serviceAmount: number;
  taxAmount: number;
  previewTotal: number;
}

/**
 * Side-effect-free preview of the service/extras amount and its Stripe Tax
 * — no DB write at all, safe to call from a Server Component render.
 * Extracted from prepareVisitPaymentReview's own internal tax-preview step
 * (that function now calls this same helper for its existing preview,
 * removing the duplication, not adding any — its external behavior is
 * unchanged). A Stripe Tax Calculation call only (service line item, no
 * tip), never linked to a PaymentIntent and never persisted as the
 * authoritative stripe_tax_calculation_id.
 *
 * Used directly by the admin "Record Cash/Zelle Payment Received" form
 * (recordCashOrZellePayment's read-only display step) so opening that form
 * never creates or fetches a service_visit_payments row.
 */
export async function previewServiceAmountAndTax(
  gateway: VisitPaymentGateway,
  visit: ServiceVisitRow,
  pricing: ServiceVisitPricingRow
): Promise<ServiceAmountAndTaxPreview> {
  const serviceAmount = pricing.amountDueFromCustomer;
  if (serviceAmount <= 0) {
    return { serviceAmount, taxAmount: 0, previewTotal: serviceAmount };
  }

  const address = resolveTaxLocationAddress(visit);
  const preview = await gateway.createTaxCalculation({
    serviceAmountCents: toStripeCents(serviceAmount),
    tipAmountCents: 0,
    address,
  });

  return {
    serviceAmount,
    taxAmount: preview.taxAmountExclusiveCents / 100,
    previewTotal: preview.amountTotalCents / 100,
  };
}
