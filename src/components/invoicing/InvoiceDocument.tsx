import type { InvoiceRow } from "@/lib/scheduling/domain-types";
import { formatMoney } from "@/lib/admin/format";
import { utcToZonedDateTime } from "@/lib/scheduling/timezone";
import BrandLogo from "@/components/brand/BrandLogo";
import PrintButton from "./PrintButton";

/** The one timezone this business operates in (see Approved Service Area) — invoices carry no per-row timezone of their own, unlike a service_visit. */
const INVOICE_DISPLAY_TIMEZONE = "America/Chicago";

/**
 * `value` is either an already-bare calendar date (service_date — no time
 * component, nothing to convert) or a real UTC timestamptz (issue_date,
 * void_at). A timestamptz MUST be converted to this business's own
 * timezone before reading off its calendar date — formatting it directly
 * in UTC (the previous bug here) can show the wrong day entirely for a
 * document issued late at night Central time, since that instant can
 * already be past midnight UTC. Both cases end up as the same kind of
 * bare "YYYY-MM-DD" string before display, so one formatter handles both
 * correctly without silently reinterpreting a date-only value through a
 * timezone conversion it was never subject to.
 */
export function formatInvoiceDate(value: Date | string | null): string {
  if (!value) return "—";
  const calendarDate = typeof value === "string" ? value : utcToZonedDateTime(value, INVOICE_DISPLAY_TIMEZONE).date;
  const date = new Date(`${calendarDate}T00:00:00Z`);
  return date.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
}

/** formatMoney is sign-naive ($-25.00 for a negative amount) — a discount line item needs the conventional "-$25.00" instead. */
export function formatLineAmount(amount: number): string {
  return amount < 0 ? `-${formatMoney(Math.abs(amount))}` : formatMoney(amount);
}

export default function InvoiceDocument({ invoice }: { invoice: InvoiceRow }) {
  const address = [invoice.serviceAddressLine1, invoice.serviceAddressLine2, [invoice.serviceCity, invoice.serviceState, invoice.serviceZip].filter(Boolean).join(", ")]
    .filter(Boolean)
    .join(", ");

  const lineItems: { label: string; amount: number }[] = [];
  if (invoice.baseAmount > 0) lineItems.push({ label: invoice.description, amount: invoice.baseAmount });
  if (invoice.roomAdjustmentsAmount !== 0) lineItems.push({ label: "Room adjustments", amount: invoice.roomAdjustmentsAmount });
  for (const addOn of invoice.addOnsDetail) {
    lineItems.push({ label: addOn.pricingKind === "starting_at" ? `${addOn.label} (starting at)` : addOn.label, amount: addOn.amount });
  }
  if (invoice.travelAmount > 0) lineItems.push({ label: "Travel", amount: invoice.travelAmount });
  if (invoice.suppliesAmount > 0) lineItems.push({ label: "Supplies & equipment", amount: invoice.suppliesAmount });
  for (const charge of invoice.customChargesDetail) {
    lineItems.push({ label: charge.description, amount: charge.amount });
  }
  if (invoice.cancellationFeeAmount > 0) lineItems.push({ label: "Cancellation fee", amount: invoice.cancellationFeeAmount });
  if (invoice.discountDetail.length > 0) {
    for (const discount of invoice.discountDetail) {
      lineItems.push({ label: discount.description, amount: -discount.amount });
    }
  } else if (invoice.discountAmount > 0) {
    lineItems.push({ label: invoice.discountDescription ?? "Discount", amount: -invoice.discountAmount });
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 rounded-2xl border border-border bg-surface p-8 print:border-0 print:p-0">
      <BrandLogo />

      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Invoice</h1>
          <p className="mt-1 text-sm text-muted">{invoice.invoiceNumber}</p>
        </div>
        <div className="print:hidden">
          <PrintButton />
        </div>
      </div>

      {invoice.paymentStatus === "void" && (
        <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          This invoice was voided on {formatInvoiceDate(invoice.voidAt)}
          {invoice.voidReason ? `: ${invoice.voidReason}` : "."}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 text-sm">
        <div>
          <div className="text-muted">Billed to</div>
          <div className="font-medium text-foreground">{invoice.customerDisplayName}</div>
          {address && <div className="text-foreground">{address}</div>}
        </div>
        <div className="text-right">
          <div className="text-muted">Issue date</div>
          <div className="font-medium text-foreground">{formatInvoiceDate(invoice.issueDate)}</div>
          {invoice.serviceDate && (
            <>
              <div className="mt-2 text-muted">Service date</div>
              <div className="font-medium text-foreground">{formatInvoiceDate(invoice.serviceDate)}</div>
            </>
          )}
        </div>
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-muted">
            <th className="py-2 font-medium">Description</th>
            <th className="py-2 text-right font-medium">Amount</th>
          </tr>
        </thead>
        <tbody>
          {lineItems.map((item, index) => (
            <tr key={index} className="border-b border-border/60">
              <td className="py-2 text-foreground">{item.label}</td>
              <td className="py-2 text-right text-foreground">{formatLineAmount(item.amount)}</td>
            </tr>
          ))}
          <tr className="border-b border-border/60">
            <td className="py-2 text-foreground">Subtotal</td>
            <td className="py-2 text-right text-foreground">{formatMoney(invoice.subtotalAmount)}</td>
          </tr>
          {invoice.taxAmount > 0 && (
            <tr className="border-b border-border/60">
              <td className="py-2 text-foreground">Tax</td>
              <td className="py-2 text-right text-foreground">{formatMoney(invoice.taxAmount)}</td>
            </tr>
          )}
        </tbody>
        <tfoot>
          <tr>
            <td className="pt-3 text-base font-semibold text-foreground">Total</td>
            <td className="pt-3 text-right text-base font-semibold text-foreground">{formatMoney(invoice.totalAmount)}</td>
          </tr>
        </tfoot>
      </table>

      <p className="text-xs text-muted">Voluntary gratuity, if any, is shown on the linked receipt only and is not part of this invoice&apos;s total.</p>
    </div>
  );
}
