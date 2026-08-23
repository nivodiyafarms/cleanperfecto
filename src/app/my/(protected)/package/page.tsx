import ActionForm from "@/components/admin/ActionForm";
import { formatCadenceLabel, formatMoney } from "@/lib/admin/format";
import { findPackageDetail } from "@/lib/admin/queries/packages";
import { requestPackageCadenceChangeAction, respondToPackageAmendmentAction } from "@/lib/customer-portal/actions/package-actions";
import { getMostRecentPackageSummary } from "@/lib/customer-portal/queries";
import { requireCustomer } from "@/lib/customer-portal/require-customer";

export default async function MyPackagePage() {
  const session = await requireCustomer();
  const summary = await getMostRecentPackageSummary(session.customerId);

  if (!summary) {
    return <p className="text-sm text-muted">You don&apos;t have a prepaid package.</p>;
  }

  const detail = await findPackageDetail(summary.id);
  if (!detail) {
    return <p className="text-sm text-muted">You don&apos;t have a prepaid package.</p>;
  }

  const pendingAmendment = detail.amendments.find((a) => a.approvalState === "pending_customer_approval");

  return (
    <div className="space-y-8">
      <section>
        <h1 className="text-xl font-semibold text-foreground">My Package</h1>
        <p className="mt-2 text-sm text-foreground">{formatCadenceLabel(detail.frequency)}</p>
        <p className="mt-1 text-sm text-foreground">
          {detail.purchasedVisitCount} purchased · {detail.purchasedVisitCount - detail.remainingVisitCount} completed ·{" "}
          {detail.remainingVisitCount} remaining
        </p>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-foreground">All Six Planned Visits</h2>
        <ol className="mt-2 space-y-1 text-sm text-foreground">
          {detail.plans.map((plan) => (
            <li key={plan.id}>
              Visit {plan.visitNumber}: {plan.plannedDate} — {plan.linkedVisitStatus ?? "Planned"}
            </li>
          ))}
        </ol>
      </section>

      {pendingAmendment ? (
        <section className="rounded-xl border border-border bg-surface p-4">
          <h2 className="text-lg font-semibold text-foreground">Cadence Change Requested</h2>
          <p className="mt-2 text-sm text-foreground">
            New cadence: {formatCadenceLabel(pendingAmendment.newCadence)}, effective visit #{pendingAmendment.effectiveFromVisitNumber}
          </p>
          <p className="mt-1 text-sm text-foreground">
            {pendingAmendment.valueDifference > 0
              ? `Additional balance: ${formatMoney(pendingAmendment.valueDifference)}`
              : pendingAmendment.valueDifference < 0
                ? `Refund/credit: ${formatMoney(Math.abs(pendingAmendment.valueDifference))}`
                : "No change in price."}
          </p>
          <div className="mt-3 flex gap-3">
            <ActionForm action={respondToPackageAmendmentAction}>
              <input type="hidden" name="packageAmendmentId" value={pendingAmendment.id} />
              <input type="hidden" name="decision" value="approve" />
              <button type="submit" className="rounded-md bg-primary px-3 py-1.5 text-sm font-semibold text-white">
                Approve
              </button>
            </ActionForm>
            <ActionForm action={respondToPackageAmendmentAction}>
              <input type="hidden" name="packageAmendmentId" value={pendingAmendment.id} />
              <input type="hidden" name="decision" value="reject" />
              <button type="submit" className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-background-alt">
                Decline
              </button>
            </ActionForm>
          </div>
        </section>
      ) : (
        detail.status === "active" && (
          <section>
            <h2 className="text-lg font-semibold text-foreground">Request Cadence Change</h2>
            <ActionForm action={requestPackageCadenceChangeAction} className="mt-2 flex flex-wrap items-end gap-3">
              <input type="hidden" name="prepaidPackageId" value={detail.id} />
              <div>
                <label className="block text-xs font-medium text-muted">New cadence</label>
                <select name="newCadence" required className="rounded-md border border-border px-2 py-1 text-sm">
                  <option value="weekly">Weekly</option>
                  <option value="biweekly">Every 2 Weeks</option>
                  <option value="every_4_weeks">Every 4 Weeks</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-muted">Effective from visit #</label>
                <input type="number" name="effectiveFromVisitNumber" min={1} max={6} required className="w-20 rounded-md border border-border px-2 py-1 text-sm" />
              </div>
              <button type="submit" className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-background-alt">
                Request change
              </button>
            </ActionForm>
          </section>
        )
      )}
    </div>
  );
}
