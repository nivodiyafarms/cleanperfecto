import type { RecurringScopeVersionRow } from "./domain-types";
import { InvalidVisitStateError } from "./errors";
import type { SchedulingRepository } from "./repository";

/**
 * Approves a pending recurring_scope_versions row: activates it and, if it
 * supersedes a previously-active version, marks that old one superseded —
 * mirroring package_amendments' own approval convention. Completed visits
 * are never touched; only FUTURE visits estimated/scheduled after this
 * point (see estimate-visit-pricing.ts) use the newly active scope.
 */
export async function approveRecurringScopeChange(
  repo: SchedulingRepository,
  recurringScopeVersionId: string
): Promise<RecurringScopeVersionRow> {
  const version = await repo.findRecurringScopeVersionById(recurringScopeVersionId);
  if (!version) {
    throw new InvalidVisitStateError(`recurring_scope_version ${recurringScopeVersionId} not found`);
  }
  if (version.status !== "pending_customer_approval") {
    throw new InvalidVisitStateError(
      `recurring_scope_version ${recurringScopeVersionId} is not pending approval (status=${version.status})`
    );
  }

  if (version.supersedesId) {
    await repo.supersedeRecurringScopeVersion(version.supersedesId);
  }

  const updated = await repo.updateRecurringScopeVersionStatus(version.id, "active");
  if (!updated) {
    throw new InvalidVisitStateError(`recurring_scope_version ${recurringScopeVersionId} could not be activated`);
  }
  return updated;
}

/** Declines a pending scope-change proposal — the previously-active version (if any) is left untouched and remains active. */
export async function rejectRecurringScopeChange(
  repo: SchedulingRepository,
  recurringScopeVersionId: string
): Promise<RecurringScopeVersionRow> {
  const version = await repo.findRecurringScopeVersionById(recurringScopeVersionId);
  if (!version) {
    throw new InvalidVisitStateError(`recurring_scope_version ${recurringScopeVersionId} not found`);
  }
  if (version.status !== "pending_customer_approval") {
    throw new InvalidVisitStateError(
      `recurring_scope_version ${recurringScopeVersionId} is not pending approval (status=${version.status})`
    );
  }
  const updated = await repo.updateRecurringScopeVersionStatus(version.id, "rejected");
  if (!updated) {
    throw new InvalidVisitStateError(`recurring_scope_version ${recurringScopeVersionId} could not be rejected`);
  }
  return updated;
}
