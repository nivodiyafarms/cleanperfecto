"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin/require-admin";
import { resolvePackageSchedulingContext } from "@/lib/admin/queries/visit-scope";
import { applyPackageAmendment } from "@/lib/scheduling/apply-package-amendment";
import { createPackageAmendment } from "@/lib/scheduling/create-package-amendment";
import { InvalidVisitStateError } from "@/lib/scheduling/errors";
import { planPackageVisitDates } from "@/lib/scheduling/plan-package-visit-dates";
import { replanPackageCadence } from "@/lib/scheduling/replan-package-cadence";
import { replanPackageVisit } from "@/lib/scheduling/replan-package-visit";
import { schedulePackageVisitPlan } from "@/lib/scheduling/schedule-package-visit-plan";
import { createSupabaseSchedulingRepository } from "@/lib/scheduling/supabase-scheduling-repository";
import type { RecurringCadence } from "@/lib/scheduling/types";
import { actionError, actionOk, type ActionResult } from "./types";

const CADENCES: RecurringCadence[] = ["weekly", "biweekly", "every_4_weeks"];

function revalidatePackagePaths(packageId: string): void {
  revalidatePath("/admin/packages");
  revalidatePath(`/admin/packages/${packageId}`);
}

function isValidCadence(value: string): value is RecurringCadence {
  return (CADENCES as string[]).includes(value);
}

/** Plans all of a package's intended visit dates — never creates fake service_visits (see plan-package-visit-dates.ts). A distinct, later, explicit action from purchase itself. */
export async function planPackageVisitDatesAction(_prevState: ActionResult | null, formData: FormData): Promise<ActionResult> {
  await requireAdmin();
  const prepaidPackageId = String(formData.get("prepaidPackageId") ?? "");
  const cadence = String(formData.get("cadence") ?? "");
  const firstDate = String(formData.get("firstDate") ?? "");
  const firstStartTime = String(formData.get("firstStartTime") ?? "");

  if (!prepaidPackageId || !firstDate || !firstStartTime || !isValidCadence(cadence)) {
    return actionError("Choose a cadence, first date, and start time.");
  }

  const context = await resolvePackageSchedulingContext(prepaidPackageId);
  if (!context) return actionError("Could not resolve this package's originating booking.");

  const repo = createSupabaseSchedulingRepository();
  await planPackageVisitDates(repo, {
    prepaidPackageId,
    customerId: context.customerId,
    cadence,
    firstDate,
    firstStartTime,
  });

  revalidatePackagePaths(prepaidPackageId);
  return actionOk("Visit dates planned.");
}

/** "Change only this visit" — moves a single not-yet-linked plan; every other plan is untouched. */
export async function replanPackageVisitAction(_prevState: ActionResult | null, formData: FormData): Promise<ActionResult> {
  await requireAdmin();
  const packageVisitPlanId = String(formData.get("packageVisitPlanId") ?? "");
  const prepaidPackageId = String(formData.get("prepaidPackageId") ?? "");
  const newPlannedDate = String(formData.get("newPlannedDate") ?? "");
  const newPlannedStartTime = String(formData.get("newPlannedStartTime") ?? "");

  if (!packageVisitPlanId || !newPlannedDate || !newPlannedStartTime) {
    return actionError("Choose a new date and start time.");
  }

  const repo = createSupabaseSchedulingRepository();
  try {
    await replanPackageVisit(repo, { packageVisitPlanId, newPlannedDate, newPlannedStartTime });
  } catch (error) {
    if (error instanceof InvalidVisitStateError) return actionError(error.message);
    return actionError("Could not move this visit.");
  }

  if (prepaidPackageId) revalidatePackagePaths(prepaidPackageId);
  return actionOk("Visit date updated.");
}

/** "Change this and future" — regenerates remaining still-planned visits from the given visit number onward; completed/linked visits are never touched. */
export async function replanPackageCadenceAction(_prevState: ActionResult | null, formData: FormData): Promise<ActionResult> {
  await requireAdmin();
  const prepaidPackageId = String(formData.get("prepaidPackageId") ?? "");
  const effectiveFromVisitNumber = Number(formData.get("effectiveFromVisitNumber"));
  const newCadence = String(formData.get("newCadence") ?? "");
  const newFirstDate = String(formData.get("newFirstDate") ?? "");
  const newFirstStartTime = String(formData.get("newFirstStartTime") ?? "");

  if (!prepaidPackageId || !effectiveFromVisitNumber || !newFirstDate || !newFirstStartTime || !isValidCadence(newCadence)) {
    return actionError("Choose a starting visit number, cadence, date, and time.");
  }

  const repo = createSupabaseSchedulingRepository();
  const updated = await replanPackageCadence(repo, {
    prepaidPackageId,
    effectiveFromVisitNumber,
    newCadence,
    newFirstDate,
    newFirstStartTime,
  });

  revalidatePackagePaths(prepaidPackageId);
  return actionOk(updated.length > 0 ? `Updated ${updated.length} upcoming visit(s).` : "No eligible upcoming visits to update.");
}

/** Turns a planning-stage plan into a real 'requested' service_visit — the only thing that ever links a plan to an operational visit. */
export async function schedulePackageVisitPlanAction(_prevState: ActionResult | null, formData: FormData): Promise<ActionResult> {
  await requireAdmin();
  const packageVisitPlanId = String(formData.get("packageVisitPlanId") ?? "");
  const prepaidPackageId = String(formData.get("prepaidPackageId") ?? "");
  if (!packageVisitPlanId || !prepaidPackageId) return actionError("Plan not found.");

  const context = await resolvePackageSchedulingContext(prepaidPackageId);
  if (!context) return actionError("Could not resolve this package's originating booking.");

  const repo = createSupabaseSchedulingRepository();
  const result = await schedulePackageVisitPlan(repo, {
    packageVisitPlanId,
    customerId: context.customerId,
    cleaningType: context.cleaningType,
    serviceAddressLine1: context.serviceAddressLine1,
    serviceAddressLine2: context.serviceAddressLine2,
    serviceCity: context.serviceCity,
    serviceState: context.serviceState,
    serviceAddressIdentity: context.serviceAddressIdentity,
  });

  revalidatePackagePaths(prepaidPackageId);
  revalidatePath(`/admin/visits/${result.visitId}`);
  return actionOk(result.alreadyLinked ? "This plan was already linked to a visit." : "Visit scheduled from plan.");
}

/**
 * Prices a proposed cadence change for the package's REMAINING visits only,
 * via the existing server-authoritative calculateEstimate() (inside
 * createPackageAmendment) — never duplicated here. Starts in
 * pending_customer_approval; nothing is applied yet.
 */
export async function createPackageAmendmentAction(_prevState: ActionResult | null, formData: FormData): Promise<ActionResult> {
  await requireAdmin();
  const prepaidPackageId = String(formData.get("prepaidPackageId") ?? "");
  const newCadence = String(formData.get("newCadence") ?? "");
  const effectiveFromVisitNumber = Number(formData.get("effectiveFromVisitNumber"));
  const reason = String(formData.get("reason") ?? "").trim() || undefined;

  if (!prepaidPackageId || !effectiveFromVisitNumber || !isValidCadence(newCadence)) {
    return actionError("Choose a starting visit number and a new cadence.");
  }

  const context = await resolvePackageSchedulingContext(prepaidPackageId);
  if (!context) return actionError("Could not resolve this package's originating booking.");

  const repo = createSupabaseSchedulingRepository();
  try {
    await createPackageAmendment(repo, {
      prepaidPackageId,
      newCadence,
      effectiveFromVisitNumber,
      baseInput: context.calculationInput,
      now: new Date(),
      reason,
    });
  } catch (error) {
    if (error instanceof InvalidVisitStateError) return actionError(error.message);
    return actionError("Could not price this cadence change.");
  }

  revalidatePackagePaths(prepaidPackageId);
  return actionOk("Amendment prepared — pending customer approval.");
}

/**
 * Records that customer approval was obtained (e.g. by phone) — this is
 * administering the SAME approval_state the domain model already exposes
 * via SchedulingRepository.updatePackageAmendmentState, not a new bypass.
 * applyPackageAmendmentAction below still refuses to proceed unless this
 * (and, for an increase, payment) has actually been recorded — the gate is
 * enforced by apply-package-amendment.ts itself, not by this UI.
 */
export async function recordAmendmentApprovalAction(_prevState: ActionResult | null, formData: FormData): Promise<ActionResult> {
  await requireAdmin();
  const packageAmendmentId = String(formData.get("packageAmendmentId") ?? "");
  const prepaidPackageId = String(formData.get("prepaidPackageId") ?? "");
  const decision = String(formData.get("decision") ?? "");
  if (!packageAmendmentId || (decision !== "approved" && decision !== "rejected")) {
    return actionError("Choose approve or reject.");
  }

  const repo = createSupabaseSchedulingRepository();
  const updated = await repo.updatePackageAmendmentState(packageAmendmentId, { approvalState: decision });
  if (!updated) return actionError("Amendment not found.");

  if (prepaidPackageId) revalidatePackagePaths(prepaidPackageId);
  return actionOk(decision === "approved" ? "Customer approval recorded." : "Amendment marked rejected.");
}

/** Records that the additional balance for a price-increase amendment was collected (outside this system — no automatic charging exists). */
export async function recordAmendmentPaymentAction(_prevState: ActionResult | null, formData: FormData): Promise<ActionResult> {
  await requireAdmin();
  const packageAmendmentId = String(formData.get("packageAmendmentId") ?? "");
  const prepaidPackageId = String(formData.get("prepaidPackageId") ?? "");
  if (!packageAmendmentId) return actionError("Amendment not found.");

  const repo = createSupabaseSchedulingRepository();
  const updated = await repo.updatePackageAmendmentState(packageAmendmentId, { paymentState: "additional_payment_completed" });
  if (!updated) return actionError("Amendment not found.");

  if (prepaidPackageId) revalidatePackagePaths(prepaidPackageId);
  return actionOk("Payment recorded.");
}

/** Applies an approved (and, for an increase, paid) amendment — gated entirely by apply-package-amendment.ts itself; this action invents no bypass. */
export async function applyPackageAmendmentAction(_prevState: ActionResult | null, formData: FormData): Promise<ActionResult> {
  await requireAdmin();
  const packageAmendmentId = String(formData.get("packageAmendmentId") ?? "");
  const prepaidPackageId = String(formData.get("prepaidPackageId") ?? "");
  const newFirstDate = String(formData.get("newFirstDate") ?? "");
  const newFirstStartTime = String(formData.get("newFirstStartTime") ?? "");

  if (!packageAmendmentId || !newFirstDate || !newFirstStartTime) {
    return actionError("Choose the first date/time for the new cadence.");
  }

  const repo = createSupabaseSchedulingRepository();
  try {
    const updated = await applyPackageAmendment(repo, { packageAmendmentId, newFirstDate, newFirstStartTime });
    if (prepaidPackageId) revalidatePackagePaths(prepaidPackageId);
    return actionOk(`Amendment applied — ${updated.length} upcoming visit(s) updated.`);
  } catch (error) {
    if (error instanceof InvalidVisitStateError) return actionError(error.message);
    return actionError("Could not apply this amendment.");
  }
}
