"use server";

import { revalidatePath } from "next/cache";
import { actionError, actionOk, type ActionResult } from "@/lib/admin/actions/types";
import { cancelServiceVisit } from "@/lib/scheduling/cancel-service-visit";
import { InvalidVisitStateError, SchedulingConflictError } from "@/lib/scheduling/errors";
import { replanRecurringVisit } from "@/lib/scheduling/replan-recurring-visit";
import { requestVisitReschedule } from "@/lib/scheduling/request-visit-reschedule";
import { createSupabaseSchedulingRepository } from "@/lib/scheduling/supabase-scheduling-repository";
import { requireCustomer } from "@/lib/customer-portal/require-customer";
import { assertRecurringVisitPlanBelongsToCustomer, assertVisitBelongsToCustomer, CustomerOwnershipError } from "@/lib/customer-portal/ownership";

/**
 * "Change only this one cleaning" for a still-'planned' (unlinked)
 * recurring_visit_plans row — nothing operational exists yet, so this
 * applies immediately, no admin confirmation needed. Works identically for
 * Pay Per Cleaning and prepaid-package customers.
 */
export async function requestReplanVisitAction(_prevState: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const session = await requireCustomer();
  const repo = createSupabaseSchedulingRepository();

  const recurringVisitPlanId = String(formData.get("recurringVisitPlanId") ?? "");
  const date = String(formData.get("date") ?? "");
  const startTime = String(formData.get("startTime") ?? "");
  if (!recurringVisitPlanId || !date || !startTime) {
    return actionError("Missing required fields.");
  }

  try {
    await assertRecurringVisitPlanBelongsToCustomer(repo, recurringVisitPlanId, session.customerId);
    await replanRecurringVisit(repo, { recurringVisitPlanId, newPlannedDate: date, newPlannedStartTime: startTime });
  } catch (error) {
    if (error instanceof CustomerOwnershipError || error instanceof InvalidVisitStateError) {
      return actionError(error.message);
    }
    throw error;
  }

  revalidatePath("/my");
  revalidatePath("/my/cleanings");
  return actionOk("Preferred date updated.");
}

/**
 * Customer requests a new date/time for an already-'scheduled' (admin-
 * confirmed) visit — records the request only (service_visits.
 * requested_start_at), never silently overwrites the confirmed operational
 * schedule. Admin reviews and applies it via the existing Admin Dashboard.
 */
export async function requestVisitRescheduleAction(_prevState: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const session = await requireCustomer();
  const repo = createSupabaseSchedulingRepository();

  const serviceVisitId = String(formData.get("serviceVisitId") ?? "");
  const date = String(formData.get("date") ?? "");
  const startTime = String(formData.get("startTime") ?? "");
  if (!serviceVisitId || !date || !startTime) {
    return actionError("Missing required fields.");
  }

  try {
    await assertVisitBelongsToCustomer(repo, serviceVisitId, session.customerId);
    await requestVisitReschedule(repo, { serviceVisitId, newDate: date, newStartTime: startTime });
  } catch (error) {
    if (error instanceof CustomerOwnershipError || error instanceof InvalidVisitStateError) {
      return actionError(error.message);
    }
    throw error;
  }

  revalidatePath("/my");
  revalidatePath("/my/cleanings");
  return actionOk("Reschedule requested — we'll confirm shortly.");
}

/**
 * Customer cancels an eligible upcoming visit — fully self-service, since
 * cancelServiceVisit is deterministic (policy-based fee, no cleaner
 * decision involved). Never consumes a package credit.
 */
export async function cancelVisitAction(_prevState: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const session = await requireCustomer();
  const repo = createSupabaseSchedulingRepository();

  const serviceVisitId = String(formData.get("serviceVisitId") ?? "");
  if (!serviceVisitId) {
    return actionError("Missing visit id.");
  }

  try {
    await assertVisitBelongsToCustomer(repo, serviceVisitId, session.customerId);
    const result = await cancelServiceVisit(repo, { serviceVisitId, now: new Date(), actor: "customer" });

    revalidatePath("/my");
    revalidatePath("/my/cleanings");

    if (!result.changed) {
      return actionOk("This cleaning was already completed or cancelled.");
    }
    if (result.fee && result.fee.amount > 0) {
      return actionOk(`Cancelled — a $${result.fee.amount.toFixed(2)} fee applies per our cancellation policy.`);
    }
    return actionOk("Cancelled — no fee applies.");
  } catch (error) {
    if (error instanceof CustomerOwnershipError || error instanceof InvalidVisitStateError || error instanceof SchedulingConflictError) {
      return actionError(error.message);
    }
    throw error;
  }
}
