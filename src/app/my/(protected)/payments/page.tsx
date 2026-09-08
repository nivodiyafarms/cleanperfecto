import ActionForm from "@/components/admin/ActionForm";
import { formatMoney } from "@/lib/admin/format";
import { approveVisitPricingIncreaseAction } from "@/lib/customer-portal/actions/scope-actions";
import { getPaymentsSummary } from "@/lib/customer-portal/queries";
import { requireCustomer } from "@/lib/customer-portal/require-customer";
import { createSupabaseSchedulingRepository } from "@/lib/scheduling/supabase-scheduling-repository";
import { canCreateStripeCharge } from "@/lib/config/payment-capabilities";
import VisitPaymentFlow from "@/components/customer-portal/VisitPaymentFlow";

export default async function MyPaymentsPage() {
  const session = await requireCustomer();
  const summary = await getPaymentsSummary(session.customerId);
  const stripeChargesAvailable = canCreateStripeCharge();

  const repo = createSupabaseSchedulingRepository();
  const visits = await repo.listServiceVisitsForCustomer(session.customerId);
  const visitsNeedingPayment: string[] = [];
  for (const visit of visits) {
    if (visit.status !== "completed") continue;
    const pricing = await repo.findServiceVisitPricingByVisitId(visit.id);
    if (pricing && pricing.priceStatus === "confirmed") {
      visitsNeedingPayment.push(visit.id);
    }
  }

  return (
    <div className="space-y-8">
      <h1 className="text-xl font-semibold text-foreground">Payments</h1>

      {visitsNeedingPayment.length > 0 && (
        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-foreground">Review Charges &amp; Pay</h2>
          {visitsNeedingPayment.map((serviceVisitId) => (
            <VisitPaymentFlow key={serviceVisitId} serviceVisitId={serviceVisitId} stripeChargesAvailable={stripeChargesAvailable} />
          ))}
        </section>
      )}

      <section>
        <h2 className="text-lg font-semibold text-foreground">Per-Visit Charges</h2>
        {summary.visitPricing.length === 0 ? (
          <p className="mt-2 text-sm text-muted">Nothing to show yet.</p>
        ) : (
          <ul className="mt-2 space-y-2 text-sm text-foreground">
            {summary.visitPricing.map((p) => (
              <li key={p.serviceVisitId}>
                <div>
                  {formatMoney(p.amountDueFromCustomer)} — {p.priceStatus} / {p.paymentStatus}
                </div>
                {p.priceStatus === "pending_customer_approval" && (
                  <ActionForm action={approveVisitPricingIncreaseAction} className="mt-1">
                    <input type="hidden" name="serviceVisitId" value={p.serviceVisitId} />
                    <button type="submit" className="rounded-md border border-border px-2 py-1 text-xs font-medium text-foreground hover:bg-background-alt">
                      Approve higher amount
                    </button>
                  </ActionForm>
                )}
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
