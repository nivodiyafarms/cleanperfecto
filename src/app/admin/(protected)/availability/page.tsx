import ActionForm from "@/components/admin/ActionForm";
import { listUpcomingDayOverrides } from "@/lib/admin/queries/day-overrides";
import { addDayOverrideAction, updateDayOverrideAction } from "@/lib/admin/actions/availability-actions";
import { formatTimeOfDay } from "@/lib/admin/format";
import { utcToZonedDateTime } from "@/lib/scheduling/timezone";

export default async function AdminAvailabilityPage() {
  const today = utcToZonedDateTime(new Date(), "America/Chicago").date;
  const overrides = await listUpcomingDayOverrides(today);

  return (
    <div className="max-w-2xl">
      <h1 className="text-xl font-semibold text-foreground">Availability</h1>
      <p className="mt-1 text-sm text-muted">
        Business-level scheduling blocks. &quot;Full&quot; is never stored here — it&apos;s always a live finding of the
        availability engine based on actual cleaner capacity.
      </p>

      <ul className="mt-6 divide-y divide-border rounded-2xl border border-border bg-surface">
        {overrides.map((o) => (
          <li key={o.id} className="p-4 text-sm">
            <p className="font-medium text-foreground">
              {o.overrideDate} —{" "}
              {o.type === "closed_all_day" ? "Unavailable (full day)" : `Blocked ${formatTimeOfDay(o.blockStartTime ?? "")} – ${formatTimeOfDay(o.blockEndTime ?? "")}`}
            </p>
            {o.reason && <p className="text-muted">{o.reason}</p>}
            {o.type === "partial_block" && (
              <ActionForm action={updateDayOverrideAction} className="mt-2 flex flex-wrap items-end gap-2">
                <input type="hidden" name="overrideId" value={o.id} />
                <div>
                  <label className="block text-xs font-medium text-muted">Start</label>
                  <input name="blockStartTime" type="time" defaultValue={o.blockStartTime ?? ""} className="mt-1 rounded-lg border border-border px-2 py-1 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted">End</label>
                  <input name="blockEndTime" type="time" defaultValue={o.blockEndTime ?? ""} className="mt-1 rounded-lg border border-border px-2 py-1 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted">Reason</label>
                  <input name="reason" type="text" defaultValue={o.reason ?? ""} className="mt-1 rounded-lg border border-border px-2 py-1 text-sm" />
                </div>
                <button type="submit" className="rounded-lg border border-border px-3 py-1 text-xs font-medium text-foreground hover:bg-background-alt">
                  Update
                </button>
              </ActionForm>
            )}
          </li>
        ))}
        {overrides.length === 0 && <li className="p-4 text-sm text-muted">No upcoming scheduling blocks.</li>}
      </ul>

      <div className="mt-6 rounded-2xl border border-border bg-surface p-5">
        <h2 className="text-sm font-semibold text-foreground">Add a block</h2>
        <ActionForm action={addDayOverrideAction} className="mt-3 flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs font-medium text-muted" htmlFor="overrideDate">
              Date
            </label>
            <input id="overrideDate" name="overrideDate" type="date" required className="mt-1 rounded-lg border border-border px-3 py-1.5 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted" htmlFor="type">
              Type
            </label>
            <select id="type" name="type" className="mt-1 rounded-lg border border-border px-3 py-1.5 text-sm">
              <option value="closed_all_day">Full day — unavailable</option>
              <option value="partial_block">Partial day block</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-muted" htmlFor="blockStartTime">
              Block start
            </label>
            <input id="blockStartTime" name="blockStartTime" type="time" className="mt-1 rounded-lg border border-border px-3 py-1.5 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted" htmlFor="blockEndTime">
              Block end
            </label>
            <input id="blockEndTime" name="blockEndTime" type="time" className="mt-1 rounded-lg border border-border px-3 py-1.5 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted" htmlFor="reason">
              Reason
            </label>
            <input id="reason" name="reason" type="text" className="mt-1 rounded-lg border border-border px-3 py-1.5 text-sm" />
          </div>
          <button type="submit" className="rounded-lg bg-primary px-4 py-1.5 text-sm font-semibold text-white hover:opacity-90">
            Add block
          </button>
        </ActionForm>
      </div>
    </div>
  );
}
