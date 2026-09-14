import { notFound } from "next/navigation";
import { requireCustomer } from "@/lib/customer-portal/require-customer";
import { createSupabaseSchedulingRepository } from "@/lib/scheduling/supabase-scheduling-repository";
import { assertReceiptBelongsToCustomer, CustomerOwnershipError } from "@/lib/customer-portal/ownership";
import { getReceiptRefundStatus } from "@/lib/invoicing/get-receipt-refund-status";
import ReceiptDocument from "@/components/invoicing/ReceiptDocument";

export default async function MyReceiptDetailPage({ params }: { params: Promise<{ receiptId: string }> }) {
  const { receiptId } = await params;
  const session = await requireCustomer();
  const repo = createSupabaseSchedulingRepository();

  let receipt;
  try {
    receipt = await assertReceiptBelongsToCustomer(repo, receiptId, session.customerId);
  } catch (error) {
    if (error instanceof CustomerOwnershipError) notFound();
    throw error;
  }

  const [invoice, refundStatus] = await Promise.all([repo.findInvoiceById(receipt.invoiceId), getReceiptRefundStatus(repo, receipt)]);
  return <ReceiptDocument receipt={receipt} refundStatus={refundStatus} invoiceNumber={invoice?.invoiceNumber ?? "—"} />;
}
