import { notFound } from "next/navigation";
import ActionForm from "@/components/admin/ActionForm";
import { findCleaner, listAvailabilityExceptions, listAvailabilityRules, listUpcomingAssignments } from "@/lib/admin/queries/cleaners";
import { addAvailabilityExceptionAction, addAvailabilityRuleAction, setAvailabilityRuleActiveAction } from "@/lib/admin/actions/cleaner-actions";
import { formatInstant, formatTimeOfDay } from "@/lib/admin/format";

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

interface CleanerDetailPageProps {
  params: Promise<{ cleanerId: string }>;
}

export default async function AdminCleanerDetailPage({ params }: CleanerDetailPageProps) {
  const { cleanerId } = await params;
  const cleaner = await findCleaner(cleanerId);
  if (!cleaner) notFound();

  const [rules, exceptions, upcoming] = await Promise.all([
    listAvailabilityRules(cleanerId),
    listAvailabilityExceptions(cleanerId),
    listUpcomingAssignments(cleanerId),
  ]);

  return (
    <div className="max-w-2xl">
      <h1 className="text-xl font-semibold text-foreground">
        {cleaner.name} {!cleaner.active && <span className="text-sm font-normal text-muted">(inactive)</span>}
      </h1>

      <div className="mt-6 rounded-2xl border border-border bg-surface p-5">
        <h2 className="text-sm font-semibold text-foreground">Recurring availability</h2>
        {rules.length === 0 ? (
          <p className="mt-2 text-sm text-muted">No recurring availability set.</p>
        ) : (
          <ul className="mt-2 space-y-1 text-sm">
            {rules.map((rule) => (
              <li key={rule.id} className="flex items-center justify-between gap-3">
                <span className={rule.active ? "text-foreground" : "text-muted line-through"}>
                  {DAY_NAMES[rule.dayOfWeek]}: {formatTimeOfDay(rule.startTime)} – {formatTimeOfDay(rule.endTime)}
                </span>
                <ActionForm action={setAvailabilityRuleActiveAction}>
                  <input type="hidden" name="ruleId" value={rule.id} />
                  <input type="hidden" name="cleanerId" value={cleanerId} />
                  <input type="hidden" name="active" value={(!rule.active).toString()} />
                  <button type="submit" className="rounded-md border border-border px-2 py-0.5 text-xs text-foreground hover:bg-background-alt">
                    {rule.active ? "Disable" : "Enable"}
                  </button>
                </ActionForm>
              </li>
            ))}
          </ul>
        )}

        <ActionForm action={addAvailabilityRuleAction} className="mt-4 flex flex-wrap items-end gap-2 border-t border-border pt-4">
          <input type="hidden" name="cleanerId" value={cleanerId} />
          <div>
            <label className="block text-xs font-medium text-muted" htmlFor="dayOfWeek">
              Day
            </label>
            <select id="dayOfWeek" name="dayOfWeek" className="mt-1 rounded-lg border border-border px-2 py-1.5 text-sm">
              {DAY_NAMES.map((day, index) => (
                <option key={day} value={index}>
                  {day}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-muted" htmlFor="startTime">
              Start
            </label>
            <input id="startTime" name="startTime" type="time" defaultValue="08:00" className="mt-1 rounded-lg border border-border px-2 py-1.5 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted" htmlFor="endTime">
              End
            </label>
            <input id="endTime" name="endTime" type="time" defaultValue="18:00" className="mt-1 rounded-lg border border-border px-2 py-1.5 text-sm" />
          </div>
          <button type="submit" className="rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-white hover:opacity-90">
            Add
          </button>
        </ActionForm>
      </div>

      <div className="mt-6 rounded-2xl border border-border bg-surface p-5">
        <h2 className="text-sm font-semibold text-foreground">Date-specific exceptions</h2>
        {exceptions.length === 0 ? (
          <p className="mt-2 text-sm text-muted">None.</p>
        ) : (
          <ul className="mt-2 space-y-1 text-sm text-foreground">
            {exceptions.map((exception) => (
              <li key={exception.id}>
                {exception.exceptionDate}:{" "}
                {exception.type === "unavailable_all_day"
                  ? "Unavailable all day"
                  : `${formatTimeOfDay(exception.startTime ?? "")} – ${formatTimeOfDay(exception.endTime ?? "")}`}
                {exception.reason && <span className="text-muted"> — {exception.reason}</span>}
              </li>
            ))}
          </ul>
        )}

        <ActionForm action={addAvailabilityExceptionAction} className="mt-4 flex flex-wrap items-end gap-2 border-t border-border pt-4">
          <input type="hidden" name="cleanerId" value={cleanerId} />
          <div>
            <label className="block text-xs font-medium text-muted" htmlFor="exceptionDate">
              Date
            </label>
            <input id="exceptionDate" name="exceptionDate" type="date" required className="mt-1 rounded-lg border border-border px-2 py-1.5 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted" htmlFor="type">
              Type
            </label>
            <select id="type" name="type" className="mt-1 rounded-lg border border-border px-2 py-1.5 text-sm">
              <option value="unavailable_all_day">Unavailable all day</option>
              <option value="custom_hours">Custom hours</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-muted" htmlFor="exceptionStart">
              Start
            </label>
            <input id="exceptionStart" name="startTime" type="time" className="mt-1 rounded-lg border border-border px-2 py-1.5 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted" htmlFor="exceptionEnd">
              End
            </label>
            <input id="exceptionEnd" name="endTime" type="time" className="mt-1 rounded-lg border border-border px-2 py-1.5 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted" htmlFor="reason">
              Reason
            </label>
            <input id="reason" name="reason" type="text" className="mt-1 rounded-lg border border-border px-2 py-1.5 text-sm" />
          </div>
          <button type="submit" className="rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-white hover:opacity-90">
            Save
          </button>
        </ActionForm>
      </div>

      <div className="mt-6 rounded-2xl border border-border bg-surface p-5">
        <h2 className="text-sm font-semibold text-foreground">Upcoming assignments</h2>
        {upcoming.length === 0 ? (
          <p className="mt-2 text-sm text-muted">None scheduled.</p>
        ) : (
          <ul className="mt-2 space-y-1 text-sm text-foreground">
            {upcoming.map((a) => (
              <li key={a.serviceVisitId}>
                {formatInstant(a.confirmedStartAt)} — {a.customerName}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
