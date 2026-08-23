import { formatMoney } from "@/lib/admin/format";
import { getPaymentsSummary } from "@/lib/customer-portal/queries";
import { requireCustomer } from "@/lib/customer-portal/require-customer";

export default async function MyPaymentsPage() {
  const session = await requireCustomer();
  const summary = await getPaymentsSummary(session.customerId);

  return (
    <div className="space-y-8">
      <h1 className="text-xl font-semibold text-foreground">Payments</h1>

      <section>
        <h2 className="text-lg font-semibold text-foreground">Per-Visit Charges</h2>
        {summary.visitPricing.length === 0 ? (
          <p className="mt-2 text-sm text-muted">Nothing to show yet.</p>
        ) : (
          <ul className="mt-2 space-y-1 text-sm text-foreground">
            {summary.visitPricing.map((p) => (
              <li key={p.serviceVisitId}>
                {formatMoney(p.amountDueFromCustomer)} — {p.priceStatus} / {p.paymentStatus}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="text-lg font-semibold text-foreground">Fees</h2>
        {summary.fees.length === 0 ? (
          <p className="mt-2 text-sm text-muted">No fees on your account.</p>
        ) : (
          <ul className="mt-2 space-y-1 text-sm text-foreground">
            {summary.fees.map((fee) => (
              <li key={fee.id}>
                {fee.visitDate ?? "—"} — {fee.feeType} — {formatMoney(fee.amount)} ({fee.state})
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="text-lg font-semibold text-foreground">Package Changes</h2>
        {summary.packageAmendments.length === 0 ? (
          <p className="mt-2 text-sm text-muted">No package changes on your account.</p>
        ) : (
          <ul className="mt-2 space-y-1 text-sm text-foreground">
            {summary.packageAmendments.map((a) => (
              <li key={a.id}>
                {a.valueDifference > 0 ? `+${formatMoney(a.valueDifference)}` : formatMoney(a.valueDifference)} — {a.approvalState} /{" "}
                {a.paymentState}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
