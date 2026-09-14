import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/admin/require-admin";
import { createSupabaseSchedulingRepository } from "@/lib/scheduling/supabase-scheduling-repository";
import { getReceiptRefundStatus } from "@/lib/invoicing/get-receipt-refund-status";
import ReceiptDocument from "@/components/invoicing/ReceiptDocument";

export default async function AdminReceiptDetailPage({ params }: { params: Promise<{ receiptId: string }> }) {
  const { receiptId } = await params;
  await requireAdmin();
  const repo = createSupabaseSchedulingRepository();
  const receipt = await repo.findReceiptById(receiptId);
  if (!receipt) notFound();

  const [invoice, refundStatus] = await Promise.all([repo.findInvoiceById(receipt.invoiceId), getReceiptRefundStatus(repo, receipt)]);
  return <ReceiptDocument receipt={receipt} refundStatus={refundStatus} invoiceNumber={invoice?.invoiceNumber ?? "—"} />;
}
