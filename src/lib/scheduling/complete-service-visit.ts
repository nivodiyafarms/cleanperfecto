import { replenishRecurringVisitPlans } from "./replenish-recurring-visit-plans";
import { cancelPendingReminder } from "./schedule-visit-reminder";
import type { SchedulingRepository } from "./repository";

/**
 * Completes a visit via the atomic complete_service_visit() Postgres
 * function (see supabase-scheduling-repository.ts / the migration) — the
 * ONLY place package credit is ever consumed, and only exactly once even
 * under a retried/duplicate call. Logs a 'completed' event only on the
 * call that actually performed the transition (never on an idempotent
 * no-op retry), matching this codebase's existing "only fire side effects
 * on the run that performed the real transition" convention (see
 * updateBookingOrderStatus's `changed` boolean in the booking module).
 */
export async function completeServiceVisit(repo: SchedulingRepository, serviceVisitId: string, actor?: string): Promise<boolean> {
  const before = await repo.findServiceVisitById(serviceVisitId);
  await repo.completeServiceVisitRpc(serviceVisitId);
  const after = await repo.findServiceVisitById(serviceVisitId);

  const changed = before?.status === "scheduled" && after?.status === "completed";
  if (changed) {
    await repo.insertServiceVisitEvent({
      serviceVisitId,
      eventType: "completed",
      actor: actor ?? null,
      previousState: { status: "scheduled" },
      newState: { status: "completed" },
      notes: null,
    });
    await cancelPendingReminder(repo, serviceVisitId);

    // Maintain the customer's rolling six-cleaning horizon (owner-approved):
    // a completed occurrence under an active recurring relationship no
    // longer occupies a horizon slot, so top it back up. A no-op for a
    // genuinely one-off visit or a schedule that isn't 'active'
    // (paused/superseded/cancelled) — see replenish-recurring-visit-plans.ts.
    //
    // service_visits.recurring_schedule_id is null for the FIRST (direct)
    // visit of a normal booking by design (service_visits_one_direct_visit_
    // per_booking_order) even though its universal calendar slot #1 is
    // linked to it — fall back to the linked recurring_visit_plans row's
    // own recurringScheduleId so completing that very first visit still
    // replenishes the horizon.
    const recurringScheduleId = after?.recurringScheduleId ?? (await repo.findRecurringVisitPlanByServiceVisitId(serviceVisitId))?.recurringScheduleId ?? null;
    if (recurringScheduleId) {
      await replenishRecurringVisitPlans(repo, recurringScheduleId);
    }
  }

  return changed;
}
