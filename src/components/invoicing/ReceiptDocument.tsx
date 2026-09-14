import type { ReceiptRow } from "@/lib/scheduling/domain-types";
import type { ReceiptRefundStatus } from "@/lib/invoicing/get-receipt-refund-status";
import { formatMoney } from "@/lib/admin/format";
import PrintButton from "./PrintButton";

function formatDateTime(value: Date): string {
  return value.toLocaleString("en-US", { year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" });
}

const REFUND_STATUS_LABEL: Record<ReceiptRefundStatus["refundStatus"], string> = {
  none: "Paid in full",
  partial: "Partially refunded",
  full: "Fully refunded",
};

export default function ReceiptDocument({ receipt, refundStatus, invoiceNumber }: { receipt: ReceiptRow; refundStatus: ReceiptRefundStatus; invoiceNumber: string }) {
  return (
    <div className="mx-auto max-w-2xl space-y-6 rounded-2xl border border-border bg-surface p-8 print:border-0 print:p-0">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Receipt</h1>
          <p className="mt-1 text-sm text-muted">{receipt.receiptNumber}</p>
          <p className="text-xs text-muted">Invoice {invoiceNumber}</p>
        </div>
        <div className="print:hidden">
          <PrintButton />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 text-sm">
        <div>
          <div className="text-muted">Paid on</div>
          <div className="font-medium text-foreground">{formatDateTime(receipt.paymentTimestamp)}</div>
        </div>
        <div className="text-right">
          <div className="text-muted">Payment method</div>
          <div className="font-medium text-foreground">{receipt.paymentMethodDisplay}</div>
        </div>
      </div>

      <table className="w-full text-sm">
        <tbody>
          <tr className="border-b border-border/60">
            <td className="py-2 text-foreground">Amount paid</td>
            <td className="py-2 text-right text-foreground">{formatMoney(receipt.amountPaid)}</td>
          </tr>
          {receipt.taxPaid > 0 && (
            <tr className="border-b border-border/60">
              <td className="py-2 text-muted">Includes tax</td>
              <td className="py-2 text-right text-muted">{formatMoney(receipt.taxPaid)}</td>
            </tr>
          )}
          {receipt.tipPaid > 0 && (
            <tr className="border-b border-border/60">
              <td className="py-2 text-muted">Includes tip</td>
              <td className="py-2 text-right text-muted">{formatMoney(receipt.tipPaid)}</td>
            </tr>
          )}
          {refundStatus.refundedAmount > 0 && (
            <tr className="border-b border-border/60">
              <td className="py-2 text-foreground">Refunded</td>
              <td className="py-2 text-right text-foreground">-{formatMoney(refundStatus.refundedAmount)}</td>
            </tr>
          )}
        </tbody>
        <tfoot>
          <tr>
            <td className="pt-3 text-base font-semibold text-foreground">Net amount paid</td>
            <td className="pt-3 text-right text-base font-semibold text-foreground">{formatMoney(refundStatus.netAmountPaid)}</td>
          </tr>
        </tfoot>
      </table>

      <div className="text-sm font-medium text-foreground">{REFUND_STATUS_LABEL[refundStatus.refundStatus]}</div>

      {receipt.stripePaymentIntentId && <p className="text-xs text-muted">Reference: {receipt.stripePaymentIntentId}</p>}
    </div>
  );
}
