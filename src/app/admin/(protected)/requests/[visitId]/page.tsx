import { notFound } from "next/navigation";
import ActionForm from "@/components/admin/ActionForm";
import { listCleaners } from "@/lib/admin/queries/cleaners";
import { findServiceVisitDetail } from "@/lib/admin/queries/service-visits";
import { resolveDurationInputForVisit } from "@/lib/admin/queries/visit-scope";
import { confirmVisitAction } from "@/lib/admin/actions/schedule-actions";
import { formatCadenceLabel, formatInstant, formatTimeOfDay, localDateOf, localTimeOf } from "@/lib/admin/format";
import { estimateDuration } from "@/lib/scheduling/duration-engine";
import { findAvailableCleaners } from "@/lib/scheduling/find-available-cleaners";
import { findAvailableStartTimes } from "@/lib/scheduling/find-available-start-times";
import { createSupabaseSchedulingRepository } from "@/lib/scheduling/supabase-scheduling-repository";

interface RequestDetailPageProps {
  params: Promise<{ visitId: string }>;
  searchParams: Promise<{ date?: string; startTime?: string }>;
}

export default async function AdminRequestDetailPage({ params, searchParams }: RequestDetailPageProps) {
  const { visitId } = await params;
  const query = await searchParams;

  const visit = await findServiceVisitDetail(visitId);
  if (!visit) notFound();

  const durationInput = await resolveDurationInputForVisit(visit);
  const duration = durationInput ? estimateDuration(durationInput) : null;

  const selectedDate = query.date || (visit.requestedStartAt ? localDateOf(visit.requestedStartAt) : "");
  const selectedStartTime = query.startTime || (visit.requestedStartAt ? localTimeOf(visit.requestedStartAt) : "");

  const repo = createSupabaseSchedulingRepository();
  const cleaners = await listCleaners();
  const cleanerNameById = new Map(cleaners.map((c) => [c.id, c.name]));

  const availableStartTimes =
    duration && selectedDate
      ? await findAvailableStartTimes(repo, {
          date: selectedDate,
          serviceMinutes: duration.estimatedServiceMinutes,
          requiredCleanerCount: duration.recommendedCleanerCount,
          timezone: visit.timezone,
        })
      : null;

  const availableCleaners =
    duration && selectedDate && selectedStartTime
      ? await findAvailableCleaners(repo, {
          date: selectedDate,
          startTime: selectedStartTime,
          serviceMinutes: duration.estimatedServiceMinutes,
          timezone: visit.timezone,
        })
      : null;

  return (
    <div className="max-w-3xl">
      <h1 className="text-xl font-semibold text-foreground">Request — {visit.customerName}</h1>
      <p className="mt-1 text-sm text-muted">
        Requested {formatInstant(visit.requestedStartAt)} · {formatCadenceLabel(visit.cleaningType)}
        {visit.visitNumber ? ` · Package visit ${visit.visitNumber}` : ""}
      </p>
      {(visit.serviceAddressLine1 || visit.serviceCity) && (
        <p className="text-sm text-muted">
          {[visit.serviceAddressLine1, visit.serviceAddressLine2, visit.serviceCity, visit.serviceState, visit.serviceZip]
            .filter(Boolean)
            .join(", ")}
        </p>
      )}

      <div className="mt-6 rounded-2xl border border-border bg-surface p-5">
        <h2 className="text-sm font-semibold text-foreground">Estimated scope</h2>
        {duration ? (
          <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-muted">Labor</dt>
              <dd className="text-foreground">{duration.estimatedLaborMinutes} min</dd>
            </div>
            <div>
              <dt className="text-muted">Recommended cleaners</dt>
              <dd className="text-foreground">{duration.recommendedCleanerCount}</dd>
            </div>
            <div>
              <dt className="text-muted">Appointment length</dt>
              <dd className="text-foreground">{duration.estimatedServiceMinutes} min</dd>
            </div>
          </dl>
        ) : (
          <p className="mt-2 text-sm text-muted">Could not determine the cleaning scope for this visit — check its originating booking.</p>
        )}
      </div>

      {duration && (
        <div className="mt-6 rounded-2xl border border-border bg-surface p-5">
          <h2 className="text-sm font-semibold text-foreground">1. Choose a date</h2>
          <form method="GET" className="mt-3 flex flex-wrap items-end gap-3">
            <div>
              <label htmlFor="date" className="block text-xs font-medium text-muted">
                Date
              </label>
              <input
                id="date"
                name="date"
                type="date"
                defaultValue={selectedDate}
                required
                className="mt-1 rounded-lg border border-border px-3 py-1.5 text-sm text-foreground"
              />
            </div>
            <button type="submit" className="rounded-lg bg-primary px-4 py-1.5 text-sm font-semibold text-white hover:opacity-90">
              Find availability
            </button>
          </form>

          {availableStartTimes && (
            <div className="mt-4">
              <h3 className="text-sm font-semibold text-foreground">2. Choose a start time</h3>
              {availableStartTimes.closedByOverride ? (
                <p className="mt-2 text-sm text-red-600">CleanPerfecto is closed on this date.</p>
              ) : availableStartTimes.availableStartTimes.length === 0 ? (
                <p className="mt-2 text-sm text-muted">No availability on this date — try another date.</p>
              ) : (
                <div className="mt-2 flex flex-wrap gap-2">
                  {availableStartTimes.availableStartTimes.map((time) => (
                    <a
                      key={time}
                      href={`?date=${selectedDate}&startTime=${time}`}
                      className={`rounded-lg border px-3 py-1.5 text-sm ${
                        time === selectedStartTime
                          ? "border-primary bg-primary text-white"
                          : "border-border text-foreground hover:border-secondary"
                      }`}
                    >
                      {formatTimeOfDay(time)}
                    </a>
                  ))}
                </div>
              )}
            </div>
          )}

          {availableCleaners && selectedStartTime && (
            <ActionForm action={confirmVisitAction} className="mt-4">
              <input type="hidden" name="visitId" value={visitId} />
              <input type="hidden" name="date" value={selectedDate} />
              <input type="hidden" name="startTime" value={selectedStartTime} />

              <h3 className="text-sm font-semibold text-foreground">3. Assign cleaner(s) and confirm</h3>
              <p className="text-xs text-muted">Need {duration.recommendedCleanerCount} cleaner(s) for this job.</p>
              <div className="mt-2 space-y-1">
                {availableCleaners.cleaners.map((c) => (
                  <label key={c.cleanerId} className={`flex items-center gap-2 text-sm ${c.available ? "text-foreground" : "text-muted"}`}>
                    <input type="checkbox" name="cleanerIds" value={c.cleanerId} disabled={!c.available} />
                    {cleanerNameById.get(c.cleanerId) ?? c.cleanerId}
                    {!c.available && " (unavailable)"}
                  </label>
                ))}
                {availableCleaners.cleaners.length === 0 && <p className="text-sm text-muted">No active cleaners configured.</p>}
              </div>

              <button type="submit" className="mt-4 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:opacity-90">
                Confirm appointment
              </button>
            </ActionForm>
          )}
        </div>
      )}
    </div>
  );
}
