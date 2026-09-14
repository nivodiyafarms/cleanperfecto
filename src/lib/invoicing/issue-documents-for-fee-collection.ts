import "server-only";

import type { SchedulingRepository } from "@/lib/scheduling/repository";
import type { InvoiceRow, ReceiptRow, ServiceFeeAssessmentRow } from "@/lib/scheduling/domain-types";
import { buildCancellationFeeInvoiceAndReceipt } from "./build-cancellation-fee-invoice";

/**
 * Issues the invoice+receipt pair for an externally-collected cancellation/
 * reschedule/no-access fee — called exactly once, right after
 * collectServiceFeeAssessmentWithAudit succeeds (collect-service-fee.ts).
 * Same best-effort convention as issue-documents-for-visit-payment.ts — a
 * documentation failure must never be mistaken for a failed collection.
 */
export async function issueDocumentsForFeeCollection(
  repo: SchedulingRepository,
  feeAssessment: ServiceFeeAssessmentRow
): Promise<{ invoice: InvoiceRow; receipt: ReceiptRow }> {
  const visit = await repo.findServiceVisitById(feeAssessment.serviceVisitId);
  if (!visit) throw new Error(`[invoicing] service_visit ${feeAssessment.serviceVisitId} not found for fee assessment ${feeAssessment.id}`);

  const customerDisplayName = await repo.findCustomerDisplayName(visit.customerId);
  const { invoiceInput, receiptInput } = buildCancellationFeeInvoiceAndReceipt({ visit, customerDisplayName, feeAssessment });

  const invoice = await repo.issueInvoice(invoiceInput);
  const receipt = await repo.issueReceipt({ ...receiptInput, invoiceId: invoice.id });
  return { invoice, receipt };
}
