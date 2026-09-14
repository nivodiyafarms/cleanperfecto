import type { SchedulingRepository } from "@/lib/scheduling/repository";
import type { ReceiptRow } from "@/lib/scheduling/domain-types";
import { roundToCents } from "@/lib/pricing/money";

export interface ReceiptRefundStatus {
  refundedAmount: number;
  netAmountPaid: number;
  refundStatus: "none" | "partial" | "full";
}

/**
 * Live-joins the receipt's current refund state from its actual
 * source-of-truth row (service_visit_payments.refundedAmount or
 * prepaid_packages.refundedAmount) rather than storing it on the receipt
 * itself — see ReceiptRow's doc comment. A cancellation_fee receipt has no
 * refund concept in this schema (a fee is only ever waived pre-collection,
 * never refunded post-collection), so it always reports 'none'.
 */
export async function getReceiptRefundStatus(repo: SchedulingRepository, receipt: ReceiptRow): Promise<ReceiptRefundStatus> {
  let refundedAmount = 0;

  if (receipt.sourceType === "visit_payment" && receipt.serviceVisitPaymentId) {
    const payment = await repo.findServiceVisitPaymentById(receipt.serviceVisitPaymentId);
    refundedAmount = payment?.refundedAmount ?? 0;
  } else if (receipt.sourceType === "prepaid_package" && receipt.prepaidPackageId) {
    const pkg = await repo.findPrepaidPackageById(receipt.prepaidPackageId);
    refundedAmount = pkg?.refundedAmount ?? 0;
  }

  const netAmountPaid = roundToCents(receipt.amountPaid - refundedAmount);
  const refundStatus: ReceiptRefundStatus["refundStatus"] = refundedAmount <= 0 ? "none" : refundedAmount >= receipt.amountPaid ? "full" : "partial";

  return { refundedAmount, netAmountPaid, refundStatus };
}
