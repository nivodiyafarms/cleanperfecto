import "server-only";

import type { SchedulingRepository } from "@/lib/scheduling/repository";
import type { InvoiceRow, ReceiptRow, ServiceVisitPaymentRow } from "@/lib/scheduling/domain-types";
import { buildServiceVisitInvoiceAndReceipt } from "./build-service-visit-invoice";

/**
 * Issues the invoice+receipt pair for a per-visit payment that just settled
 * (stripe_card via reconcile-visit-payment.ts, or zelle/cash via
 * record-external-payment.ts) — called exactly once, on the genuine first
 * transition into 'paid', by each of those two call sites. Never throws
 * into the caller's payment-success path on a documentation-only failure;
 * callers wrap this in a best-effort catch, mirroring the existing
 * enqueueNotification(...).catch(() => {}) convention — a failure to issue
 * paperwork must never be mistaken for (or roll back) a failed payment.
 */
export async function issueDocumentsForVisitPayment(
  repo: SchedulingRepository,
  payment: ServiceVisitPaymentRow
): Promise<{ invoice: InvoiceRow; receipt: ReceiptRow }> {
  const visit = await repo.findServiceVisitById(payment.serviceVisitId);
  if (!visit) throw new Error(`[invoicing] service_visit ${payment.serviceVisitId} not found for payment ${payment.id}`);

  const [pricing, customerDisplayName] = await Promise.all([
    repo.findServiceVisitPricingByVisitId(payment.serviceVisitId),
    repo.findCustomerDisplayName(visit.customerId),
  ]);

  const { invoiceInput, receiptInput } = buildServiceVisitInvoiceAndReceipt({ visit, pricing, customerDisplayName, payment });

  const invoice = await repo.issueInvoice(invoiceInput);
  const receipt = await repo.issueReceipt({ ...receiptInput, invoiceId: invoice.id });
  return { invoice, receipt };
}
