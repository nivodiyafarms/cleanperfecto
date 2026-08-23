import { notFound } from "next/navigation";
import Link from "next/link";
import ActionForm from "@/components/admin/ActionForm";
import StatusBadge from "@/components/admin/StatusBadge";
import { CANCELLATION_POLICY_TIERS } from "@/lib/booking/cancellation-policy";
import { listCleaners } from "@/lib/admin/queries/cleaners";
import { findServiceVisitDetail, listServiceFeeAssessments, listServiceVisitEvents } from "@/lib/admin/queries/service-visits";
import { resolveDurationInputForVisit } from "@/lib/admin/queries/visit-scope";
import { cancelVisitAction, completeVisitAction, reassignCleanersAction, rescheduleVisitAction, waiveFeeAction } from "@/lib/admin/actions/schedule-actions";
import { formatCadenceLabel, formatInstant, formatMoney, localDateOf, localTimeOf } from "@/lib/admin/format";
import { estimateDuration } from "@/lib/scheduling/duration-engine";
import { findAvailableCleaners } from "@/lib/scheduling/find-available-cleaners";
import { createSupabaseSchedulingRepository } from "@/lib/scheduling/supabase-scheduling-repository";

interface VisitDetailPageProps {
  params: Promise<{ visitId: string }>;
  searchParams: Promise<{ date?: string; startTime?: string }>;
}

export default async function AdminVisitDetailPage({ params, searchParams }: VisitDetailPageProps) {
  const { visitId } = await params;
  const query = await searchParams;

  const visit = await findServiceVisitDetail(visitId);
  if (!visit) notFound();

  const [events, fees, cleaners, durationInput] = await Promise.all([
    listServiceVisitEvents(visitId),
    listServiceFeeAssessments(visitId),
    listCleaners(),
    resolveDurationInputForVisit(visit),
  ]);
  const cleanerNameById = new Map(cleaners.map((c) => [c.id, c.name]));

  const canManage = visit.status === "scheduled";
  const rescheduleDate = query.date || (visit.confirmedStartAt ? localDateOf(visit.confirmedStartAt) : "");
  const rescheduleStartTime = query.startTime || (visit.confirmedStartAt ? localTimeOf(visit.confirmedStartAt) : "");
  const duration = durationInput ? estimateDuration(durationInput) : null;

  const availableCleaners =
    canManage && duration && rescheduleDate && rescheduleStartTime
      ? await findAvailableCleaners(createSupabaseSchedulingRepository(), {
          date: rescheduleDate,
          startTime: rescheduleStartTime,
          serviceMinutes: duration.estimatedServiceMinutes,
          timezone: visit.timezone,
        })
      : null;

  return (
    <div className="max-w-3xl">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-semibold text-foreground">Visit — {visit.customerName}</h1>
        <StatusBadge status={visit.status} />
      </div>
      <p className="mt-1 text-sm text-muted">
        {visit.confirmedStartAt && visit.confirmedEndAt
          ? `${formatInstant(visit.confirmedStartAt)} – ${localTimeOf(visit.confirmedEndAt)}`
          : formatInstant(visit.requestedStartAt)}
        {" · "}
        {formatCadenceLabel(visit.cleaningType)}
        {visit.visitNumber ? ` · Package visit ${visit.visitNumber}` : ""}
      </p>
      {(visit.serviceAddressLine1 || visit.serviceCity) && (
        <p className="text-sm text-muted">
          {[visit.serviceAddressLine1, visit.serviceAddressLine2, visit.serviceCity, visit.serviceState, visit.serviceZip]
            .filter(Boolean)
            .join(", ")}
        </p>
      )}
      {visit.assignedCleaners.length > 0 && (
        <p className="text-sm text-muted">Assigned: {visit.assignedCleaners.map((c) => c.cleanerName).join(", ")}</p>
      )}

      {canManage && (
        <div className="mt-6 grid gap-6 sm:grid-cols-2">
          <div className="rounded-2xl border border-border bg-surface p-5">
            <h2 className="text-sm font-semibold text-foreground">Reassign cleaner(s)</h2>
            <ActionForm action={reassignCleanersAction} className="mt-3">
              <input type="hidden" name="visitId" value={visitId} />
              <div className="space-y-1">
                {cleaners.map((c) => (
                  <label key={c.id} className="flex items-center gap-2 text-sm text-foreground">
                    <input
                      type="checkbox"
                      name="cleanerIds"
                      value={c.id}
                      defaultChecked={visit.assignedCleaners.some((a) => a.cleanerId === c.id)}
                    />
                    {c.name}
                    {!c.active && " (inactive)"}
                  </label>
                ))}
              </div>
              <button type="submit" className="mt-3 rounded-lg bg-primary px-4 py-1.5 text-sm font-semibold text-white hover:opacity-90">
                Update assignment
              </button>
            </ActionForm>
          </div>

          <div className="rounded-2xl border border-border bg-surface p-5">
            <h2 className="text-sm font-semibold text-foreground">Mark completed</h2>
            <p className="mt-1 text-xs text-muted">
              {visit.prepaidPackageId
                ? "This will consume exactly one package credit."
                : "This does not charge the customer — post-cleaning charging isn't built yet."}
            </p>
            <ActionForm action={completeVisitAction} className="mt-3">
              <input type="hidden" name="visitId" value={visitId} />
              <button type="submit" className="rounded-lg bg-emerald-600 px-4 py-1.5 text-sm font-semibold text-white hover:opacity-90">
                Mark completed
              </button>
            </ActionForm>
          </div>
        </div>
      )}

      {canManage && (
        <div className="mt-6 rounded-2xl border border-border bg-surface p-5">
          <h2 className="text-sm font-semibold text-foreground">Reschedule</h2>
          <form method="GET" className="mt-3 flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-xs font-medium text-muted" htmlFor="date">
                Date
              </label>
              <input id="date" name="date" type="date" defaultValue={rescheduleDate} className="mt-1 rounded-lg border border-border px-3 py-1.5 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted" htmlFor="startTime">
                Start time
              </label>
              <input id="startTime" name="startTime" type="time" defaultValue={rescheduleStartTime} className="mt-1 rounded-lg border border-border px-3 py-1.5 text-sm" />
            </div>
            <button type="submit" className="rounded-lg border border-border px-4 py-1.5 text-sm font-medium text-foreground hover:bg-background-alt">
              Check availability
            </button>
          </form>

          {availableCleaners && (
            <ActionForm action={rescheduleVisitAction} className="mt-4">
              <input type="hidden" name="visitId" value={visitId} />
              <input type="hidden" name="date" value={rescheduleDate} />
              <input type="hidden" name="startTime" value={rescheduleStartTime} />
              <p className="text-xs text-muted">Choose cleaner(s) for the new time:</p>
              <div className="mt-1 space-y-1">
                {availableCleaners.cleaners.map((c) => (
                  <label key={c.cleanerId} className={`flex items-center gap-2 text-sm ${c.available ? "text-foreground" : "text-muted"}`}>
                    <input type="checkbox" name="cleanerIds" value={c.cleanerId} disabled={!c.available} defaultChecked={c.available && visit.assignedCleaners.some((a) => a.cleanerId === c.cleanerId)} />
                    {cleanerNameById.get(c.cleanerId) ?? c.cleanerId}
                    {!c.available && " (unavailable)"}
                  </label>
                ))}
              </div>
              <button type="submit" className="mt-3 rounded-lg bg-primary px-4 py-1.5 text-sm font-semibold text-white hover:opacity-90">
                Confirm new time
              </button>
            </ActionForm>
          )}
        </div>
      )}

      {canManage && (
        <div className="mt-6 rounded-2xl border border-border bg-surface p-5">
          <h2 className="text-sm font-semibold text-foreground">Cancel visit</h2>
          <div className="mt-2 text-xs text-muted">
            <p className="font-medium text-foreground">Cancellation policy:</p>
            <ul className="mt-1 list-disc pl-4">
              {CANCELLATION_POLICY_TIERS.map((tier) => (
                <li key={tier.window}>
                  {tier.window}: {tier.fee}
                </li>
              ))}
            </ul>
          </div>
          <ActionForm action={cancelVisitAction} className="mt-3">
            <input type="hidden" name="visitId" value={visitId} />
            <label className="flex items-center gap-2 text-sm text-foreground">
              <input type="checkbox" name="noAccess" />
              Cleaner was dispatched / no access at the property
            </label>
            <label className="mt-2 block text-xs font-medium text-muted" htmlFor="reason">
              Reason (optional)
            </label>
            <input id="reason" name="reason" type="text" className="mt-1 w-full rounded-lg border border-border px-3 py-1.5 text-sm" />
            <button type="submit" className="mt-3 rounded-lg border border-red-300 px-4 py-1.5 text-sm font-semibold text-red-700 hover:bg-red-50">
              Cancel this visit
            </button>
          </ActionForm>
        </div>
      )}

      {fees.length > 0 && (
        <div className="mt-6 rounded-2xl border border-border bg-surface p-5">
          <h2 className="text-sm font-semibold text-foreground">Fee assessments</h2>
          <ul className="mt-3 space-y-3">
            {fees.map((fee) => (
              <li key={fee.id} className="text-sm">
                <p className="text-foreground">
                  {formatMoney(fee.amount)} — {fee.feeType} ({fee.state})
                </p>
                {fee.reason && <p className="text-muted">{fee.reason}</p>}
                {fee.state === "assessed" && (
                  <ActionForm action={waiveFeeAction} className="mt-1">
                    <input type="hidden" name="feeAssessmentId" value={fee.id} />
                    <input type="hidden" name="visitId" value={visitId} />
                    <div className="flex flex-wrap items-center gap-2">
                      <input name="reason" type="text" placeholder="Reason for waiving" className="rounded-lg border border-border px-2 py-1 text-xs" required />
                      <button type="submit" className="rounded-lg border border-border px-3 py-1 text-xs font-medium text-foreground hover:bg-background-alt">
                        Waive
                      </button>
                    </div>
                  </ActionForm>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-6 rounded-2xl border border-border bg-surface p-5">
        <h2 className="text-sm font-semibold text-foreground">History</h2>
        {events.length === 0 ? (
          <p className="mt-2 text-sm text-muted">No history yet.</p>
        ) : (
          <ol className="mt-3 space-y-2 text-sm">
            {events.map((event) => (
              <li key={event.id} className="text-foreground">
                <span className="font-medium">{event.eventType.replace(/_/g, " ")}</span>{" "}
                <span className="text-muted">{formatInstant(event.occurredAt)}</span>
                {event.actor && <span className="text-muted"> · {event.actor}</span>}
              </li>
            ))}
          </ol>
        )}
      </div>

      {visit.prepaidPackageId && (
        <p className="mt-6 text-sm">
          <Link href={`/admin/packages/${visit.prepaidPackageId}`} className="font-medium text-secondary hover:underline">
            View package →
          </Link>
        </p>
      )}
    </div>
  );
}
