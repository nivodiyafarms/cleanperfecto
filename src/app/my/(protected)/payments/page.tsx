import Link from "next/link";
import { notFound } from "next/navigation";
import { formatMoney } from "@/lib/admin/format";
import { getPaymentsSummary } from "@/lib/customer-portal/queries";
import { assertVisitBelongsToCustomer, CustomerOwnershipError } from "@/lib/customer-portal/ownership";
import { requireCustomer } from "@/lib/customer-portal/require-customer";
import { createSupabaseSchedulingRepository } from "@/lib/scheduling/supabase-scheduling-repository";
import { canCreateStripeCharge } from "@/lib/config/payment-capabilities";
import VisitPaymentFlow from "@/components/customer-portal/VisitPaymentFlow";

interface MyPaymentsPageProps {
  searchParams: Promise<{ visit?: string }>;
}

export default async function MyPaymentsPage({ searchParams }: MyPaymentsPageProps) {
  const session = await requireCustomer();
  const query = await searchParams;
  const stripeChargesAvailable = canCreateStripeCharge();
  const repo = createSupabaseSchedulingRepository();

  // A deep link (e.g. from the Final Total notification email or the
  // on-site QR code) renders ONE focused screen instead of the full
  // dashboard. Ownership is checked HERE, before VisitPaymentFlow ever
  // mounts — the exact same notFound()-on-CustomerOwnershipError pattern
  // already used by /my/invoices/[invoiceId] and /my/receipts/[receiptId]
  // — so a cross-customer or bogus visit id renders a plain 404 instead of
  // a client component stuck on an uncaught server-action rejection (a
  // real bug: the ownership check used to live ONLY inside
  // VisitPaymentFlow's own actions, which throw CustomerOwnershipError
  // uncaught by design — see payment-actions.ts's toErrorResult — so the
  // client's load() promise never resolved and the screen spun forever).
  // Those per-action checks still run on every load/mutation as
  // defense-in-depth; this is the first gate, not a replacement.
  if (query.visit) {
    try {
      await assertVisitBelongsToCustomer(repo, query.visit, session.customerId);
    } catch (error) {
      if (error instanceof CustomerOwnershipError) notFound();
      throw error;
    }

    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold text-foreground">Final Total</h1>
        <VisitPaymentFlow serviceVisitId={query.visit} stripeChargesAvailable={stripeChargesAvailable} />
        <Link href="/my/payments" className="inline-block text-sm font-medium text-secondary hover:underline">
          ← All payments
        </Link>
      </div>
    );
  }

  const summary = await getPaymentsSummary(session.customerId);
  const visits = await repo.listServiceVisitsForCustomer(session.customerId);
  const visitsNeedingPayment: string[] = [];
  for (const visit of visits) {
    const pricing = await repo.findServiceVisitPricingByVisitId(visit.id);
    if (!pricing) continue;
    // "confirmed" on a completed visit -> the normal final-total/tip/pay
    // screen, via VisitPaymentFlow. Pay Per Cleaning has no separate
    // price-change approval step (owner-approved product decision,
    // 2026-09-26) — Finalize & Send always confirms pricing and completes
    // the visit together, so this is a plain readiness check.
    if (pricing.priceStatus === "confirmed" && visit.status === "completed") {
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
