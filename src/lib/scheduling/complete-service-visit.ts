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
  }

  return changed;
}
