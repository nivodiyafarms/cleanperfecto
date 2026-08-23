import Link from "next/link";
import StatusBadge from "@/components/admin/StatusBadge";
import { listServiceVisitsInRange, type AdminScheduleVisit } from "@/lib/admin/queries/service-visits";
import { formatCadenceLabel, formatTimeOfDay, formatVisitStatusLabel } from "@/lib/admin/format";
import { dayOfWeekForDate } from "@/lib/scheduling/recurrence-dates";
import { utcToZonedDateTime, zonedDateTimeToUtc } from "@/lib/scheduling/timezone";
import type { CalendarDate } from "@/lib/scheduling/types";

const TIMEZONE = "America/Chicago";
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function todayLocalDate(): CalendarDate {
  return utcToZonedDateTime(new Date(), TIMEZONE).date;
}

function addDays(date: CalendarDate, days: number): CalendarDate {
  // addCadenceInterval only knows 7/14/28-day steps; for a single day we
  // reuse its exact same UTC-anchored date arithmetic via repeated weekly
  // steps is overkill — a one-day step is simplest done directly here.
  const [y, m, d] = date.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d));
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

interface SchedulePageProps {
  searchParams: Promise<{ view?: string; date?: string }>;
}

export default async function AdminSchedulePage({ searchParams }: SchedulePageProps) {
  const params = await searchParams;
  const view = params.view === "week" ? "week" : "day";
  const date = params.date && /^\d{4}-\d{2}-\d{2}$/.test(params.date) ? params.date : todayLocalDate();

  const rangeStart = date;
  const rangeEnd = view === "week" ? addDays(date, 7) : addDays(date, 1);

  const rangeStartUtc = zonedDateTimeToUtc(rangeStart, "00:00", TIMEZONE);
  const rangeEndUtc = zonedDateTimeToUtc(rangeEnd, "00:00", TIMEZONE);

  const visits = await listServiceVisitsInRange(rangeStartUtc, rangeEndUtc);

  const days: CalendarDate[] = view === "week" ? Array.from({ length: 7 }, (_, i) => addDays(date, i)) : [date];

  const visitsByDate = new Map<CalendarDate, AdminScheduleVisit[]>();
  for (const d of days) visitsByDate.set(d, []);
  for (const visit of visits) {
    const at = visit.confirmedStartAt ?? visit.requestedStartAt;
    if (!at) continue;
    const localDate = utcToZonedDateTime(new Date(at), TIMEZONE).date;
    visitsByDate.get(localDate)?.push(visit);
  }

  const prevDate = view === "week" ? addDays(date, -7) : addDays(date, -1);
  const nextDate = view === "week" ? addDays(date, 7) : addDays(date, 1);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-xl font-semibold text-foreground">Schedule</h1>
        <div className="flex items-center gap-2 text-sm">
          <Link href={`/admin?view=${view}&date=${prevDate}`} className="rounded-md border border-border px-3 py-1.5 text-foreground hover:bg-background-alt">
            ← Prev
          </Link>
          <Link href={`/admin?view=${view}&date=${todayLocalDate()}`} className="rounded-md border border-border px-3 py-1.5 text-foreground hover:bg-background-alt">
            Today
          </Link>
          <Link href={`/admin?view=${view}&date=${nextDate}`} className="rounded-md border border-border px-3 py-1.5 text-foreground hover:bg-background-alt">
            Next →
          </Link>
          <div className="ml-4 flex overflow-hidden rounded-md border border-border">
            <Link
              href={`/admin?view=day&date=${date}`}
              className={`px-3 py-1.5 ${view === "day" ? "bg-primary text-white" : "bg-surface text-foreground hover:bg-background-alt"}`}
            >
              Day
            </Link>
            <Link
              href={`/admin?view=week&date=${date}`}
              className={`px-3 py-1.5 ${view === "week" ? "bg-primary text-white" : "bg-surface text-foreground hover:bg-background-alt"}`}
            >
              Week
            </Link>
          </div>
        </div>
      </div>

      <div className={`mt-6 grid gap-4 ${view === "week" ? "grid-cols-1 md:grid-cols-2 xl:grid-cols-4" : "grid-cols-1"}`}>
        {days.map((d) => {
          const dayVisits = (visitsByDate.get(d) ?? []).slice().sort((a, b) => {
            const aAt = a.confirmedStartAt ?? a.requestedStartAt ?? "";
            const bAt = b.confirmedStartAt ?? b.requestedStartAt ?? "";
            return aAt.localeCompare(bAt);
          });
          return (
            <div key={d} className="rounded-2xl border border-border bg-surface p-4">
              <h2 className="text-sm font-semibold text-foreground">
                {DAY_NAMES[dayOfWeekForDate(d)]} {d}
              </h2>
              {dayVisits.length === 0 ? (
                <p className="mt-3 text-sm text-muted">No visits.</p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {dayVisits.map((visit) => (
                    <li key={visit.id}>
                      <ScheduleVisitCard visit={visit} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ScheduleVisitCard({ visit }: { visit: AdminScheduleVisit }) {
  const href = visit.status === "requested" ? `/admin/requests/${visit.id}` : `/admin/visits/${visit.id}`;
  const timeLabel =
    visit.status === "requested" && visit.requestedStartAt
      ? `Requested ${formatTimeOfDay(utcToZonedDateTime(new Date(visit.requestedStartAt), TIMEZONE).time)}`
      : visit.confirmedStartAt && visit.confirmedEndAt
        ? `${formatTimeOfDay(utcToZonedDateTime(new Date(visit.confirmedStartAt), TIMEZONE).time)} – ${formatTimeOfDay(utcToZonedDateTime(new Date(visit.confirmedEndAt), TIMEZONE).time)}`
        : formatVisitStatusLabel(visit.status);

  return (
    <Link
      href={href}
      className={`block rounded-lg border p-3 text-sm transition-colors hover:border-secondary ${
        visit.status === "requested" ? "border-dashed border-muted bg-background-alt" : "border-border bg-surface"
      }`}
    >
      <div className="flex items-center justify-between">
        <span className="font-medium text-foreground">{timeLabel}</span>
        <StatusBadge status={visit.status} />
      </div>
      <p className="mt-1 text-foreground">{visit.customerName}</p>
      <p className="text-muted">
        {formatCadenceLabel(visit.cleaningType)}
        {visit.visitNumber ? ` · Visit ${visit.visitNumber} of a package` : ""}
      </p>
      {(visit.serviceCity || visit.serviceZip) && (
        <p className="text-muted">
          {[visit.serviceCity, visit.serviceState, visit.serviceZip].filter(Boolean).join(", ")}
        </p>
      )}
      {visit.estimatedServiceMinutes && <p className="text-muted">~{visit.estimatedServiceMinutes} min</p>}
      {visit.assignedCleaners.length > 0 && (
        <p className="text-muted">Cleaner(s): {visit.assignedCleaners.map((c) => c.cleanerName).join(", ")}</p>
      )}
    </Link>
  );
}

