import ActionForm from "@/components/admin/ActionForm";
import { formatMoney } from "@/lib/admin/format";
import { requestVisitAddOnsAction } from "@/lib/customer-portal/actions/add-ons-actions";
import { cancelVisitAction, requestReplanVisitAction, requestVisitRescheduleAction } from "@/lib/customer-portal/actions/scheduling-actions";
import { listCleaningHistory, listNextSixVisits } from "@/lib/customer-portal/queries";
import { requireCustomer } from "@/lib/customer-portal/require-customer";
import { ADD_ON_CATALOG } from "@/lib/pricing/add-ons";

const PRICED_ADD_ONS = Object.values(ADD_ON_CATALOG).filter((a) => a.kind !== "manual_quote");

function statusLabel(status: "confirmed" | "requested" | "planned"): string {
  switch (status) {
    case "confirmed":
      return "Confirmed";
    case "requested":
      return "Requested";
    case "planned":
      return "Planned";
  }
}

export default async function MyCleaningsPage() {
  const session = await requireCustomer();
  const [upcoming, history] = await Promise.all([listNextSixVisits(session.customerId), listCleaningHistory(session.customerId)]);

  return (
    <div className="space-y-10">
      <section>
        <h1 className="text-xl font-semibold text-foreground">My Cleanings</h1>
      </section>

      <section className="space-y-6">
        <h2 className="text-lg font-semibold text-foreground">Upcoming</h2>
        {upcoming.length === 0 && <p className="text-sm text-muted">No upcoming cleanings yet.</p>}
        {upcoming.map((visit) => (
          <div key={`${visit.recurringScheduleId}-${visit.visitNumber}`} className="rounded-xl border border-border bg-surface p-4">
            <p className="text-sm font-medium text-foreground">
              {visit.date} at {visit.startTime} — {statusLabel(visit.status)}
            </p>

            {visit.status === "planned" && (
              <ActionForm action={requestReplanVisitAction} className="mt-3 flex flex-wrap items-end gap-2">
                <input type="hidden" name="recurringVisitPlanId" value={visit.recurringVisitPlanId} />
                <div>
                  <label className="block text-xs font-medium text-muted">New date</label>
                  <input type="date" name="date" required className="rounded-md border border-border px-2 py-1 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted">New time</label>
                  <input type="time" name="startTime" required className="rounded-md border border-border px-2 py-1 text-sm" />
                </div>
                <button type="submit" className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-background-alt">
                  Change this cleaning
                </button>
              </ActionForm>
            )}

            {visit.serviceVisitId && (
              <>
                <ActionForm action={requestVisitRescheduleAction} className="mt-3 flex flex-wrap items-end gap-2">
                  <input type="hidden" name="serviceVisitId" value={visit.serviceVisitId} />
                  <div>
                    <label className="block text-xs font-medium text-muted">Requested date</label>
                    <input type="date" name="date" required className="rounded-md border border-border px-2 py-1 text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-muted">Requested time</label>
                    <input type="time" name="startTime" required className="rounded-md border border-border px-2 py-1 text-sm" />
                  </div>
                  <button type="submit" className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-background-alt">
                    Request reschedule
                  </button>
                </ActionForm>

                <ActionForm action={cancelVisitAction} className="mt-3">
                  <input type="hidden" name="serviceVisitId" value={visit.serviceVisitId} />
                  <button type="submit" className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50">
                    Cancel this cleaning
                  </button>
                </ActionForm>

                <ActionForm action={requestVisitAddOnsAction} className="mt-3 space-y-2">
                  <input type="hidden" name="serviceVisitId" value={visit.serviceVisitId} />
                  <p className="text-xs font-medium text-muted">Add Extras</p>
                  <div className="flex flex-wrap gap-3">
                    {PRICED_ADD_ONS.map((addOn) => (
                      <label key={addOn.id} className="flex items-center gap-1.5 text-sm text-foreground">
                        <input type="checkbox" name="addOnIds" value={addOn.id} />
                        {addOn.label} ({formatMoney(addOn.amount ?? 0)})
                      </label>
                    ))}
                  </div>
                  <button type="submit" className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-background-alt">
                    Update extras
                  </button>
                </ActionForm>
              </>
            )}
          </div>
        ))}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-foreground">History</h2>
        {history.length === 0 && <p className="text-sm text-muted">No past cleanings yet.</p>}
        <ul className="space-y-1 text-sm text-foreground">
          {history.map((entry) => (
            <li key={entry.id}>
              {entry.confirmedDate ?? "—"} — {entry.status === "completed" ? "Completed" : "Cancelled"}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
