import { notFound } from "next/navigation";
import Link from "next/link";
import ActionForm from "@/components/admin/ActionForm";
import StatusBadge from "@/components/admin/StatusBadge";
import { findPackageDetail } from "@/lib/admin/queries/packages";
import {
  applyPackageAmendmentAction,
  createPackageAmendmentAction,
  planPackageVisitDatesAction,
  recordAmendmentApprovalAction,
  recordAmendmentPaymentAction,
  replanPackageCadenceAction,
  replanPackageVisitAction,
  schedulePackageVisitPlanAction,
} from "@/lib/admin/actions/package-actions";
import { formatCadenceLabel, formatMoney, formatTimeOfDay } from "@/lib/admin/format";

const CADENCE_OPTIONS = [
  { value: "weekly", label: "Weekly" },
  { value: "biweekly", label: "Every 2 Weeks" },
  { value: "every_4_weeks", label: "Every 4 Weeks" },
];

interface PackageDetailPageProps {
  params: Promise<{ packageId: string }>;
}

function planStatusLabel(plan: { status: string; linkedVisitStatus: string | null }): string {
  if (plan.status === "planned") return "Planned";
  switch (plan.linkedVisitStatus) {
    case "completed":
      return "Completed";
    case "scheduled":
      return "Scheduled";
    case "cancelled":
      return "Cancelled";
    case "requested":
      return "Requested";
    default:
      return "Linked";
  }
}

export default async function AdminPackageDetailPage({ params }: PackageDetailPageProps) {
  const { packageId } = await params;
  const pkg = await findPackageDetail(packageId);
  if (!pkg) notFound();

  const plannableVisitNumbers = pkg.plans.filter((p) => p.status === "planned").map((p) => p.visitNumber);

  return (
    <div className="max-w-3xl">
      <h1 className="text-xl font-semibold text-foreground">{pkg.customerName}&apos;s package</h1>
      <p className="mt-1 text-sm text-muted">
        {formatCadenceLabel(pkg.frequency)} · {formatMoney(pkg.effectivePricePerVisit)}/visit · {pkg.status}
      </p>
      <p className="mt-1 text-sm font-medium text-foreground">
        {pkg.remainingVisitCount} of {pkg.purchasedVisitCount} visits remaining
      </p>

      <div className="mt-6 rounded-2xl border border-border bg-surface p-5">
        <h2 className="text-sm font-semibold text-foreground">Visit plan</h2>

        {pkg.plans.length === 0 ? (
          <ActionForm action={planPackageVisitDatesAction} className="mt-3 flex flex-wrap items-end gap-3">
            <input type="hidden" name="prepaidPackageId" value={packageId} />
            <div>
              <label className="block text-xs font-medium text-muted" htmlFor="cadence">
                Cadence
              </label>
              <select id="cadence" name="cadence" defaultValue={pkg.frequency} className="mt-1 rounded-lg border border-border px-3 py-1.5 text-sm">
                {CADENCE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-muted" htmlFor="firstDate">
                First cleaning date
              </label>
              <input id="firstDate" name="firstDate" type="date" required className="mt-1 rounded-lg border border-border px-3 py-1.5 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted" htmlFor="firstStartTime">
                Preferred start time
              </label>
              <input id="firstStartTime" name="firstStartTime" type="time" defaultValue="10:00" required className="mt-1 rounded-lg border border-border px-3 py-1.5 text-sm" />
            </div>
            <button type="submit" className="rounded-lg bg-primary px-4 py-1.5 text-sm font-semibold text-white hover:opacity-90">
              Plan 6 visit dates
            </button>
          </ActionForm>
        ) : (
          <ul className="mt-3 space-y-3">
            {pkg.plans.map((plan) => (
              <li key={plan.id} className="rounded-lg border border-border p-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-foreground">
                    Visit #{plan.visitNumber} — {plan.plannedDate} at {formatTimeOfDay(plan.plannedStartTime)}
                  </span>
                  <StatusBadge status={planStatusLabel(plan).toLowerCase()} />
                </div>

                {plan.status === "linked" && plan.serviceVisitId && (
                  <Link href={`/admin/visits/${plan.serviceVisitId}`} className="mt-1 inline-block text-secondary hover:underline">
                    View visit →
                  </Link>
                )}

                {plan.status === "planned" && (
                  <div className="mt-2 flex flex-wrap gap-4">
                    <ActionForm action={replanPackageVisitAction} className="flex flex-wrap items-end gap-2">
                      <input type="hidden" name="packageVisitPlanId" value={plan.id} />
                      <input type="hidden" name="prepaidPackageId" value={packageId} />
                      <div>
                        <label className="block text-xs text-muted">New date</label>
                        <input name="newPlannedDate" type="date" defaultValue={plan.plannedDate} className="mt-1 rounded-md border border-border px-2 py-1 text-xs" />
                      </div>
                      <div>
                        <label className="block text-xs text-muted">New time</label>
                        <input name="newPlannedStartTime" type="time" defaultValue={plan.plannedStartTime} className="mt-1 rounded-md border border-border px-2 py-1 text-xs" />
                      </div>
                      <button type="submit" className="rounded-md border border-border px-2 py-1 text-xs font-medium text-foreground hover:bg-background-alt">
                        Change this visit
                      </button>
                    </ActionForm>

                    <ActionForm action={schedulePackageVisitPlanAction}>
                      <input type="hidden" name="packageVisitPlanId" value={plan.id} />
                      <input type="hidden" name="prepaidPackageId" value={packageId} />
                      <button type="submit" className="rounded-md bg-primary px-2 py-1 text-xs font-semibold text-white hover:opacity-90">
                        Schedule now
                      </button>
                    </ActionForm>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {plannableVisitNumbers.length > 0 && (
        <div className="mt-6 rounded-2xl border border-border bg-surface p-5">
          <h2 className="text-sm font-semibold text-foreground">Change this and future visits</h2>
          <p className="mt-1 text-xs text-muted">Only still-planned (not yet scheduled) visits are affected — completed and scheduled visits are never touched.</p>
          <ActionForm action={replanPackageCadenceAction} className="mt-3 flex flex-wrap items-end gap-3">
            <input type="hidden" name="prepaidPackageId" value={packageId} />
            <div>
              <label className="block text-xs font-medium text-muted" htmlFor="effectiveFromVisitNumber">
                Starting at visit #
              </label>
              <select id="effectiveFromVisitNumber" name="effectiveFromVisitNumber" className="mt-1 rounded-lg border border-border px-3 py-1.5 text-sm">
                {plannableVisitNumbers.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-muted" htmlFor="newCadence">
                New cadence
              </label>
              <select id="newCadence" name="newCadence" defaultValue={pkg.frequency} className="mt-1 rounded-lg border border-border px-3 py-1.5 text-sm">
                {CADENCE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-muted" htmlFor="newFirstDate">
                New first date
              </label>
              <input id="newFirstDate" name="newFirstDate" type="date" required className="mt-1 rounded-lg border border-border px-3 py-1.5 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted" htmlFor="newFirstStartTime">
                Start time
              </label>
              <input id="newFirstStartTime" name="newFirstStartTime" type="time" defaultValue="10:00" required className="mt-1 rounded-lg border border-border px-3 py-1.5 text-sm" />
            </div>
            <button type="submit" className="rounded-lg border border-border px-4 py-1.5 text-sm font-medium text-foreground hover:bg-background-alt">
              Update dates only (no repricing)
            </button>
          </ActionForm>
        </div>
      )}

      {plannableVisitNumbers.length > 0 && (
        <div className="mt-6 rounded-2xl border border-border bg-surface p-5">
          <h2 className="text-sm font-semibold text-foreground">Propose a cadence change (repricing)</h2>
          <p className="mt-1 text-xs text-muted">
            Prices only the remaining, unused visits via the same server-authoritative pricing engine used at purchase. Nothing is
            charged or changed until the customer&apos;s approval — and payment, if the price goes up — is explicitly recorded below.
          </p>
          <ActionForm action={createPackageAmendmentAction} className="mt-3 flex flex-wrap items-end gap-3">
            <input type="hidden" name="prepaidPackageId" value={packageId} />
            <div>
              <label className="block text-xs font-medium text-muted" htmlFor="amendEffectiveFrom">
                Starting at visit #
              </label>
              <select id="amendEffectiveFrom" name="effectiveFromVisitNumber" className="mt-1 rounded-lg border border-border px-3 py-1.5 text-sm">
                {plannableVisitNumbers.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-muted" htmlFor="amendCadence">
                New cadence
              </label>
              <select id="amendCadence" name="newCadence" defaultValue={pkg.frequency} className="mt-1 rounded-lg border border-border px-3 py-1.5 text-sm">
                {CADENCE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-muted" htmlFor="amendReason">
                Reason
              </label>
              <input id="amendReason" name="reason" type="text" className="mt-1 rounded-lg border border-border px-3 py-1.5 text-sm" />
            </div>
            <button type="submit" className="rounded-lg bg-primary px-4 py-1.5 text-sm font-semibold text-white hover:opacity-90">
              Price this change
            </button>
          </ActionForm>
        </div>
      )}

      {pkg.amendments.length > 0 && (
        <div className="mt-6 rounded-2xl border border-border bg-surface p-5">
          <h2 className="text-sm font-semibold text-foreground">Amendments</h2>
          <ul className="mt-3 space-y-4">
            {pkg.amendments.map((amendment) => (
              <li key={amendment.id} className="rounded-lg border border-border p-3 text-sm">
                <p className="font-medium text-foreground">
                  {formatCadenceLabel(amendment.oldCadence)} → {formatCadenceLabel(amendment.newCadence)} (from visit #
                  {amendment.effectiveFromVisitNumber})
                </p>
                <p className="text-muted">
                  {formatMoney(amendment.oldRemainingValue)} → {formatMoney(amendment.newRemainingValue)} (
                  {amendment.valueDifference > 0
                    ? `additional amount due: ${formatMoney(amendment.valueDifference)}`
                    : amendment.valueDifference < 0
                      ? `refund/credit: ${formatMoney(Math.abs(amendment.valueDifference))}`
                      : "no change"}
                  )
                </p>
                <p className="mt-1 text-xs text-muted">
                  Approval: <span className="font-medium text-foreground">{amendment.approvalState}</span> · Payment:{" "}
                  <span className="font-medium text-foreground">{amendment.paymentState}</span>
                </p>

                {amendment.approvalState === "pending_customer_approval" && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <ActionForm action={recordAmendmentApprovalAction}>
                      <input type="hidden" name="packageAmendmentId" value={amendment.id} />
                      <input type="hidden" name="prepaidPackageId" value={packageId} />
                      <input type="hidden" name="decision" value="approved" />
                      <button type="submit" className="rounded-md bg-emerald-600 px-3 py-1 text-xs font-semibold text-white hover:opacity-90">
                        Record customer approval
                      </button>
                    </ActionForm>
                    <ActionForm action={recordAmendmentApprovalAction}>
                      <input type="hidden" name="packageAmendmentId" value={amendment.id} />
                      <input type="hidden" name="prepaidPackageId" value={packageId} />
                      <input type="hidden" name="decision" value="rejected" />
                      <button type="submit" className="rounded-md border border-border px-3 py-1 text-xs font-medium text-foreground hover:bg-background-alt">
                        Mark rejected
                      </button>
                    </ActionForm>
                  </div>
                )}

                {amendment.approvalState === "approved" && amendment.valueDifference > 0 && amendment.paymentState !== "additional_payment_completed" && (
                  <ActionForm action={recordAmendmentPaymentAction} className="mt-2">
                    <input type="hidden" name="packageAmendmentId" value={amendment.id} />
                    <input type="hidden" name="prepaidPackageId" value={packageId} />
                    <button type="submit" className="rounded-md bg-emerald-600 px-3 py-1 text-xs font-semibold text-white hover:opacity-90">
                      Record additional payment received
                    </button>
                  </ActionForm>
                )}

                {amendment.approvalState === "approved" &&
                  (amendment.valueDifference <= 0 || amendment.paymentState === "additional_payment_completed") && (
                    <ActionForm action={applyPackageAmendmentAction} className="mt-2 flex flex-wrap items-end gap-2">
                      <input type="hidden" name="packageAmendmentId" value={amendment.id} />
                      <input type="hidden" name="prepaidPackageId" value={packageId} />
                      <div>
                        <label className="block text-xs text-muted">New first date</label>
                        <input name="newFirstDate" type="date" required className="mt-1 rounded-md border border-border px-2 py-1 text-xs" />
                      </div>
                      <div>
                        <label className="block text-xs text-muted">Start time</label>
                        <input name="newFirstStartTime" type="time" defaultValue="10:00" required className="mt-1 rounded-md border border-border px-2 py-1 text-xs" />
                      </div>
                      <button type="submit" className="rounded-md bg-primary px-3 py-1 text-xs font-semibold text-white hover:opacity-90">
                        Apply amendment
                      </button>
                    </ActionForm>
                  )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-6 grid gap-6 sm:grid-cols-2">
        <div className="rounded-2xl border border-border bg-surface p-5">
          <h2 className="text-sm font-semibold text-foreground">Credit usage history</h2>
          {pkg.usages.length === 0 ? (
            <p className="mt-2 text-sm text-muted">No completed visits yet.</p>
          ) : (
            <ul className="mt-2 space-y-1 text-sm text-foreground">
              {pkg.usages.map((usage) => (
                <li key={usage.id}>
                  Visit {usage.visitNumber ?? "—"} completed {new Date(usage.consumedAt).toLocaleDateString()}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-2xl border border-border bg-surface p-5">
          <h2 className="text-sm font-semibold text-foreground">Plan change history</h2>
          {pkg.planHistory.length === 0 ? (
            <p className="mt-2 text-sm text-muted">No changes yet.</p>
          ) : (
            <ul className="mt-2 space-y-1 text-sm text-foreground">
              {pkg.planHistory.map((h) => (
                <li key={h.id}>
                  Visit {h.visitNumber}: {h.previousPlannedDate ?? "—"} → {h.newPlannedDate} ({h.changeReason.replace(/_/g, " ")})
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
