import "server-only";

import type { SchedulingRepository } from "@/lib/scheduling/repository";
import type { InvoiceRow, PrepaidPackageRow, ReceiptRow } from "@/lib/scheduling/domain-types";
import { buildPrepaidPackageInvoiceAndReceipt } from "./build-prepaid-package-invoice";

/**
 * Issues the invoice+receipt pair for a prepaid package purchase — called
 * exactly once, right after activatePrepaidPackage's genuine first
 * `inserted` (webhook's finalizeVerifiedPayment). paymentMethodDisplay/
 * stripePaymentIntentId are resolved by the caller (it already has the
 * Stripe Checkout Session/PaymentIntent in hand) rather than re-fetched
 * here. Same best-effort convention as the other issue-documents-for-*
 * functions — a documentation failure must never be mistaken for a failed
 * package purchase.
 */
export async function issueDocumentsForPackagePurchase(
  repo: SchedulingRepository,
  prepaidPackage: PrepaidPackageRow,
  paymentMethodDisplay: string,
  stripePaymentIntentId: string | null
): Promise<{ invoice: InvoiceRow; receipt: ReceiptRow }> {
  const customerDisplayName = await repo.findCustomerDisplayName(prepaidPackage.customerId);
  const { invoiceInput, receiptInput } = buildPrepaidPackageInvoiceAndReceipt({
    package: prepaidPackage,
    customerDisplayName,
    paymentMethodDisplay,
    stripePaymentIntentId,
  });

  const invoice = await repo.issueInvoice(invoiceInput);
  const receipt = await repo.issueReceipt({ ...receiptInput, invoiceId: invoice.id });
  return { invoice, receipt };
}
