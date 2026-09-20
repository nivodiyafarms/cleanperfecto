import type { SchedulingRepository } from "./repository";

/**
 * Marks a visit's physical cleaning as done via the atomic
 * mark_service_visit_work_finished() Postgres function — the first half of
 * the Finalize & Send flow's two-step state model (see
 * finalize-and-send.ts): "physical work finished" is deliberately distinct
 * from "financial completion with frozen pricing" (service_visits.status =
 * 'completed'), so admin still has a window here to review/revise scope via
 * estimate-visit-pricing.ts before Finalize & Send freezes it. Logs a
 * 'work_finished' event only on the call that actually performed the
 * transition (never on an idempotent no-op retry) — same convention as
 * complete-service-visit.ts's own `changed` guard. No notification is
 * enqueued here; work-finished is an internal operational fact, not
 * something the customer is told about on its own.
 */
export async function markServiceVisitWorkFinished(repo: SchedulingRepository, serviceVisitId: string, actor?: string): Promise<boolean> {
  const before = await repo.findServiceVisitById(serviceVisitId);
  await repo.markServiceVisitWorkFinishedRpc(serviceVisitId);
  const after = await repo.findServiceVisitById(serviceVisitId);

  const changed = before?.status === "scheduled" && after?.status === "work_finished";
  if (changed) {
    await repo.insertServiceVisitEvent({
      serviceVisitId,
      eventType: "work_finished",
      actor: actor ?? null,
      previousState: { status: "scheduled" },
      newState: { status: "work_finished" },
      notes: null,
    });
  }

  return changed;
}
