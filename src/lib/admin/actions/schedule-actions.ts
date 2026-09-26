"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin/require-admin";
import { assertCapability } from "@/lib/admin/rbac/capabilities";
import { findServiceVisitDetail } from "@/lib/admin/queries/service-visits";
import { resolveDurationInputForVisit } from "@/lib/admin/queries/visit-scope";
import { cancelServiceVisit } from "@/lib/scheduling/cancel-service-visit";
import { completeServiceVisit } from "@/lib/scheduling/complete-service-visit";
import { confirmServiceVisit } from "@/lib/scheduling/confirm-service-visit";
import { markServiceVisitWorkFinished } from "@/lib/scheduling/mark-service-visit-work-finished";
import type { DurationEstimateInput } from "@/lib/scheduling/duration-engine";
import { InvalidVisitStateError, SchedulingConflictError } from "@/lib/scheduling/errors";
import { reassignCleaners } from "@/lib/scheduling/reassign-cleaners";
import { rescheduleServiceVisit } from "@/lib/scheduling/reschedule-service-visit";
import { createSupabaseSchedulingRepository } from "@/lib/scheduling/supabase-scheduling-repository";
import { actionError, actionOk, type ActionResult } from "./types";

const GENERIC_ERROR = "Something went wrong. Please try again.";

function parseCleanerIds(formData: FormData): string[] {
  return formData
    .getAll("cleanerIds")
    .map(String)
    .filter((id) => id.length > 0);
}

function revalidateVisitPaths(visitId: string): void {
  revalidatePath("/admin");
  revalidatePath("/admin/requests");
  revalidatePath(`/admin/requests/${visitId}`);
  revalidatePath(`/admin/visits/${visitId}`);
}

type LoadedDurationInput =
  | { found: true; visit: Awaited<ReturnType<typeof findServiceVisitDetail>>; durationInput: DurationEstimateInput }
  | { found: false; error: ActionResult };

async function loadDurationInputOrError(visitId: string): Promise<LoadedDurationInput> {
  const visit = await findServiceVisitDetail(visitId);
  if (!visit) {
    return { found: false, error: actionError("Visit not found.") };
  }
  const durationInput = await resolveDurationInputForVisit(visit);
  if (!durationInput) {
    return { found: false, error: actionError("Could not determine the cleaning scope for this visit — check its originating booking.") };
  }
  return { found: true, visit, durationInput };
}

/**
 * Confirms a requested visit — this, resolveDurationInputForVisit, and
 * every other admin action in this file are thin wrappers: all scheduling
 * logic (availability, conflict detection, the double-booking DB
 * constraint, the confirmed-fields snapshot, event history) lives in the
 * existing src/lib/scheduling/ domain functions and is reused unchanged.
 */
export async function confirmVisitAction(_prevState: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const admin = await requireAdmin();
  assertCapability(admin.role, "schedule_visit_operations");
  const visitId = String(formData.get("visitId") ?? "");
  const date = String(formData.get("date") ?? "");
  const startTime = String(formData.get("startTime") ?? "");
  const cleanerIds = parseCleanerIds(formData);

  if (!visitId || !date || !startTime || cleanerIds.length === 0) {
    return actionError("Choose a date, start time, and at least one cleaner.");
  }

  const repo = createSupabaseSchedulingRepository();
  const loaded = await loadDurationInputOrError(visitId);
  if (!loaded.found) return loaded.error;

  try {
    await confirmServiceVisit(repo, {
      serviceVisitId: visitId,
      date,
      startTime,
      cleanerIds,
      durationInput: loaded.durationInput,
      actor: `admin:${admin.adminUserId}`,
      // The admin request detail page lets the owner pick either a
      // suggested time or a manually-typed custom one — both reach this
      // same action, so both must be re-validated the same way. See
      // confirm-service-visit.ts's own doc comment on this flag.
      requireAvailabilityCheck: true,
    });
  } catch (error) {
    if (error instanceof SchedulingConflictError) {
      return actionError(error.message);
    }
    if (error instanceof InvalidVisitStateError) {
      return actionError(error.message);
    }
    return actionError(GENERIC_ERROR);
  }

  revalidateVisitPaths(visitId);
  return actionOk("Appointment confirmed.");
}

export async function rescheduleVisitAction(_prevState: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const admin = await requireAdmin();
  assertCapability(admin.role, "schedule_visit_operations");
  const visitId = String(formData.get("visitId") ?? "");
  const date = String(formData.get("date") ?? "");
  const startTime = String(formData.get("startTime") ?? "");
  const cleanerIds = parseCleanerIds(formData);

  if (!visitId || !date || !startTime || cleanerIds.length === 0) {
    return actionError("Choose a date, start time, and at least one cleaner.");
  }

  const repo = createSupabaseSchedulingRepository();
  const loaded = await loadDurationInputOrError(visitId);
  if (!loaded.found) return loaded.error;

  try {
    const fee = await rescheduleServiceVisit(repo, {
      serviceVisitId: visitId,
      date,
      startTime,
      cleanerIds,
      durationInput: loaded.durationInput,
      now: new Date(),
      actor: `admin:${admin.adminUserId}`,
    });
    revalidateVisitPaths(visitId);
    return actionOk(fee ? `Rescheduled — a $${fee.amount} late-change fee was recorded.` : "Rescheduled.");
  } catch (error) {
    if (error instanceof SchedulingConflictError) {
      return actionError("That slot is no longer available — availability has been refreshed. Please choose another time.");
    }
    if (error instanceof InvalidVisitStateError) {
      return actionError(error.message);
    }
    return actionError(GENERIC_ERROR);
  }
}

export async function reassignCleanersAction(_prevState: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const admin = await requireAdmin();
  assertCapability(admin.role, "schedule_visit_operations");
  const visitId = String(formData.get("visitId") ?? "");
  const cleanerIds = parseCleanerIds(formData);

  if (!visitId || cleanerIds.length === 0) {
    return actionError("Choose at least one cleaner.");
  }

  const repo = createSupabaseSchedulingRepository();
  try {
    await reassignCleaners(repo, { serviceVisitId: visitId, cleanerIds, actor: `admin:${admin.adminUserId}` });
  } catch (error) {
    if (error instanceof SchedulingConflictError) {
      return actionError("That cleaner is no longer available for this time — availability has been refreshed.");
    }
    if (error instanceof InvalidVisitStateError) {
      return actionError(error.message);
    }
    return actionError(GENERIC_ERROR);
  }

  revalidateVisitPaths(visitId);
  return actionOk("Cleaner assignment updated.");
}

export async function cancelVisitAction(_prevState: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const admin = await requireAdmin();
  assertCapability(admin.role, "schedule_visit_operations");
  const visitId = String(formData.get("visitId") ?? "");
  const noAccess = formData.get("noAccess") === "on";
  const reason = String(formData.get("reason") ?? "").trim() || undefined;

  if (!visitId) return actionError("Visit not found.");

  const repo = createSupabaseSchedulingRepository();
  const result = await cancelServiceVisit(repo, {
    serviceVisitId: visitId,
    now: new Date(),
    noAccess,
    reason,
    actor: `admin:${admin.adminUserId}`,
  });

  revalidateVisitPaths(visitId);
  if (!result.changed) {
    return actionOk("This visit was already completed or cancelled.");
  }
  return actionOk(result.fee ? `Cancelled — a $${result.fee.amount} fee was recorded.` : "Cancelled — no fee.");
}

/**
 * For a prepaid package visit this ultimately calls the idempotent
 * complete_service_visit RPC (via completeServiceVisit) — package credit
 * decrements exactly once regardless of retries, and never below zero; see
 * src/lib/scheduling/complete-service-visit.ts. For a normal (Pay Per
 * Cleaning) visit, this never triggers any Stripe charge — post-cleaning
 * charging remains deliberately unbuilt.
 */
export async function completeVisitAction(_prevState: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const admin = await requireAdmin();
  assertCapability(admin.role, "complete_service_visit");
  const visitId = String(formData.get("visitId") ?? "");
  if (!visitId) return actionError("Visit not found.");

  const repo = createSupabaseSchedulingRepository();
  const changed = await completeServiceVisit(repo, visitId, `admin:${admin.adminUserId}`);

  revalidateVisitPaths(visitId);
  revalidatePath("/admin/packages");
  return actionOk(changed ? "Marked completed." : "This visit was already completed (or isn't currently scheduled).");
}

/**
 * Cleaner/operations action marking the physical cleaning done. Gated at the
 * same operations-permitted "complete_service_visit" capability as
 * completeVisitAction — no money moves here, only a status/timestamp
 * transition. No cleaner-facing login system exists in this codebase, so
 * this is (like "Mark completed") an admin-UI action, not a separate
 * cleaner-auth surface.
 */
export async function markWorkFinishedAction(_prevState: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const admin = await requireAdmin();
  assertCapability(admin.role, "complete_service_visit");
  const visitId = String(formData.get("visitId") ?? "");
  if (!visitId) return actionError("Visit not found.");

  const repo = createSupabaseSchedulingRepository();
  const changed = await markServiceVisitWorkFinished(repo, visitId, `admin:${admin.adminUserId}`);

  revalidateVisitPaths(visitId);
  return actionOk(changed ? "Marked work finished." : "This visit was already work finished (or isn't currently scheduled).");
}

/** Waiving a fee is a financial waiver/correction — explicitly owner-only per the Phase 2 RBAC split; operations cannot call this. */
export async function waiveFeeAction(_prevState: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const admin = await requireAdmin();
  assertCapability(admin.role, "waive_fee");
  const feeAssessmentId = String(formData.get("feeAssessmentId") ?? "");
  const visitId = String(formData.get("visitId") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();

  if (!feeAssessmentId || !reason) {
    return actionError("A reason is required to waive a fee.");
  }

  const repo = createSupabaseSchedulingRepository();
  try {
    // Actor identity comes only from the authenticated requireAdmin() result
    // above — never from client-supplied form fields — and is written
    // atomically with the fee-state transition itself (see
    // waiveServiceFeeAssessmentWithAudit / financial_audit_log).
    await repo.waiveServiceFeeAssessmentWithAudit(feeAssessmentId, reason, {
      actorAdminUserId: admin.adminUserId,
      actorRole: admin.role,
    });
  } catch (error) {
    if (error instanceof InvalidVisitStateError) {
      return actionError(error.message);
    }
    return actionError(GENERIC_ERROR);
  }

  if (visitId) revalidateVisitPaths(visitId);
  return actionOk("Fee waived.");
}
