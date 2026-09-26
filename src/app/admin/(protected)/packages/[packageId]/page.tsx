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
import { refundPrepaidPackageAction } from "@/lib/admin/actions/payment-actions";
import { formatCadenceLabel, formatMoney, formatTimeOfDay } from "@/lib/admin/format";
import { hasCapability } from "@/lib/admin/rbac/capabilities";
import { requireAdmin } from "@/lib/admin/require-admin";
import { computePrepaidPackageRefund } from "@/lib/payments/compute-prepaid-package-refund";
import { hasUnknownHistoricalTax } from "@/lib/payments/prepaid-package-tax-guard";

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

  // Cancellation/refund UI — reuses the existing, already-authoritative
  // refundPrepaidPackage() pathway unchanged (via refundPrepaidPackageAction).
  // The figures below are a PREVIEW only, computed server-side (this is a
  // Server Component — nothing here runs in the browser) from whatever
  // package state was current at render time, using the exact same pure
  // formula (computePrepaidPackageRefund) the action re-runs fresh against
  // the CURRENT row the moment cancellation is actually submitted. A credit
  // consumed between this render and the confirm click is reflected in the
  // real refund regardless of what this preview showed — the form below
  // submits only prepaidPackageId + reason, never an amount.
  const admin = await requireAdmin();
  const canRefundPackage = hasCapability(admin.role, "issue_refund");
  const consumedVisitCount = pkg.purchasedVisitCount - pkg.remainingVisitCount;
  // Fail-closed: a legacy package with unknown (not authoritatively zero)
  // historical tax never gets a computed refund preview or a working
  // cancellation form — see prepaid-package-tax-guard.ts and
  // refundPrepaidPackage()'s own guard, which this UI state mirrors so the
  // owner can never be shown (and therefore never act on) a refund total
  // that silently assumed the missing tax was $0.
  const isLegacyUnknownTaxPackage = pkg.status === "active" && hasUnknownHistoricalTax(pkg);
  const refundPreview =
    pkg.status === "active" && pkg.packageTotalPaid != null && !isLegacyUnknownTaxPackage
      ? computePrepaidPackageRefund({
          packageTotalPaid: pkg.packageTotalPaid,
          taxAmount: pkg.taxAmount,
          remainingVisitCount: pkg.remainingVisitCount,
          purchasedVisitCount: pkg.purchasedVisitCount,
        })
      : null;

  return (
    <div className="max-w-3xl">
      <h1 className="text-xl font-semibold text-foreground">{pkg.customerName}&apos;s package</h1>
      <p className="mt-1 text-sm text-muted">
        {formatCadenceLabel(pkg.frequency)} · {formatMoney(pkg.effectivePricePerVisit)}/visit · {pkg.status}
      </p>
      <p className="mt-1 text-sm font-medium text-foreground">
        {pkg.remainingVisitCount} of {pkg.purchasedVisitCount} visits remaining
      </p>

      {refundPreview && (
        <div className="mt-6 rounded-2xl border border-border bg-surface p-5">
          <h2 className="text-sm font-semibold text-foreground">Package financial summary</h2>
          <dl className="mt-2 space-y-1 text-sm text-muted">
            <div>Package: {pkg.purchasedVisitCount} Cleanings</div>
            <div>Original package principal: {formatMoney(pkg.packageTotalPaid!)}</div>
            {pkg.taxAmount != null && <div>Original tax: {formatMoney(pkg.taxAmount)}</div>}
            {pkg.totalAmountPaid != null && <div>Original total paid: {formatMoney(pkg.totalAmountPaid)}</div>}
            <div>
              Completed/consumed visits: {consumedVisitCount} of {pkg.purchasedVisitCount}
            </div>
            <div>Remaining credits: {pkg.remainingVisitCount}</div>
          </dl>

          {canRefundPackage ? (
            <details className="mt-4 rounded-lg border border-red-200 bg-red-50/40 p-3 text-sm">
              <summary className="cursor-pointer font-medium text-red-700">Cancel Package &amp; Refund Remaining Balance</summary>
              <div className="mt-3 space-y-1 text-xs text-muted">
                <div>
                  Completed visits: {consumedVisitCount} of {pkg.purchasedVisitCount}
                </div>
                <div>Remaining visits: {pkg.remainingVisitCount}</div>
                <div className="mt-2 font-medium text-foreground">Refund principal: {formatMoney(refundPreview.refundAmount)}</div>
                <div className="font-medium text-foreground">Refund tax: {formatMoney(refundPreview.refundTaxAmount)}</div>
                <div className="font-semibold text-foreground">Total refund: {formatMoney(refundPreview.refundAmount + refundPreview.refundTaxAmount)}</div>
              </div>
              <ActionForm action={refundPrepaidPackageAction} className="mt-3">
                <input type="hidden" name="prepaidPackageId" value={packageId} />
                <label className="block text-xs font-medium text-muted" htmlFor="cancelPackageReason">
                  Reason (required)
                </label>
                <input
                  id="cancelPackageReason"
                  name="reason"
                  type="text"
                  required
                  className="mt-1 w-full rounded-lg border border-border px-3 py-1.5 text-sm"
                />
                <button type="submit" className="mt-3 rounded-lg border border-red-300 px-4 py-1.5 text-sm font-semibold text-red-700 hover:bg-red-50">
                  Confirm Cancellation &amp; Refund {formatMoney(refundPreview.refundAmount + refundPreview.refundTaxAmount)}
                </button>
              </ActionForm>
            </details>
          ) : (
            <p className="mt-3 text-xs text-muted">Cancellation/refund requires owner access.</p>
          )}
        </div>
      )}

      {isLegacyUnknownTaxPackage && (
        <div className="mt-6 rounded-2xl border border-amber-300 bg-amber-50/50 p-5">
          <h2 className="text-sm font-semibold text-amber-800">Legacy package — refund requires manual tax review</h2>
          <p className="mt-2 text-sm text-amber-800">
            This package was purchased before complete historical tax information was recorded. Automated cancellation/refund is
            disabled — review the original Stripe transaction before issuing a refund.
          </p>
          <dl className="mt-3 space-y-1 text-sm text-muted">
            <div>Package: {pkg.purchasedVisitCount} Cleanings</div>
            <div>Original package principal: {formatMoney(pkg.packageTotalPaid!)}</div>
            <div>
              Completed/consumed visits: {consumedVisitCount} of {pkg.purchasedVisitCount}
            </div>
            <div>Remaining credits: {pkg.remainingVisitCount}</div>
          </dl>
        </div>
      )}

      {pkg.status === "cancelled" && (
        <div className="mt-6 rounded-2xl border border-border bg-surface p-5">
          <h2 className="text-sm font-semibold text-foreground">Package canceled — refund issued</h2>
          <dl className="mt-2 space-y-1 text-sm text-muted">
            {pkg.packageTotalPaid != null && <div>Original principal: {formatMoney(pkg.packageTotalPaid)}</div>}
            <div>Refunded principal: {formatMoney(pkg.refundedAmount)}</div>
            {pkg.taxAmount != null && <div>Original tax: {formatMoney(pkg.taxAmount)}</div>}
            <div>Refunded tax: {formatMoney(pkg.refundedTaxAmount)}</div>
            {pkg.totalRefundedAmount != null && (
              <div className="font-medium text-foreground">Total refunded: {formatMoney(pkg.totalRefundedAmount)}</div>
            )}
            <div>Remaining package credits: {pkg.remainingVisitCount}</div>
            <div>Package status: {pkg.status}</div>
            {pkg.cancellationReason && <div>Reason: {pkg.cancellationReason}</div>}
          </dl>
        </div>
      )}

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
