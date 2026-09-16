"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin/require-admin";
import type { AddOnId } from "@/lib/pricing/types";
import { createSupabaseBookingRepository } from "@/lib/booking/supabase-booking-repository";
import { confirmVisitPricing } from "@/lib/scheduling/confirm-visit-pricing";
import { InvalidVisitStateError, SchedulingConflictError } from "@/lib/scheduling/errors";
import { estimateVisitPricing } from "@/lib/scheduling/estimate-visit-pricing";
import { replanRecurringCadence } from "@/lib/scheduling/replan-recurring-cadence";
import { replanRecurringVisit } from "@/lib/scheduling/replan-recurring-visit";
import { createSupabaseSchedulingRepository } from "@/lib/scheduling/supabase-scheduling-repository";
import type { RecurringCadence } from "@/lib/scheduling/types";
import { actionError, actionOk, type ActionResult } from "./types";

const CADENCES: RecurringCadence[] = ["weekly", "biweekly", "every_4_weeks"];

function isValidCadence(value: string): value is RecurringCadence {
  return (CADENCES as string[]).includes(value);
}

/**
 * Admin's "edit one occurrence" for the universal recurring_visit_plans
 * calendar — the same single authoritative domain path
 * (replanRecurringVisit) the portal uses for a Pay Per Cleaning customer's
 * own request. Works identically whether the underlying schedule is
 * Pay Per Cleaning or prepaid-package-backed; if the targeted plan is
 * linked to a package_visit_plans row, that row is kept in sync
 * automatically (see sync-linked-recurring-package-plan.ts) — admin never
 * needs a second, package-specific edit for the same occurrence.
 */
export async function editRecurringVisitDateAction(_prevState: ActionResult | null, formData: FormData): Promise<ActionResult> {
  await requireAdmin();
  const repo = createSupabaseSchedulingRepository();

  const recurringVisitPlanId = String(formData.get("recurringVisitPlanId") ?? "");
  const date = String(formData.get("date") ?? "");
  const startTime = String(formData.get("startTime") ?? "");
  if (!recurringVisitPlanId || !date || !startTime) {
    return actionError("Choose a date and start time.");
  }

  try {
    await replanRecurringVisit(repo, { recurringVisitPlanId, newPlannedDate: date, newPlannedStartTime: startTime });
  } catch (error) {
    if (error instanceof InvalidVisitStateError) return actionError(error.message);
    throw error;
  }

  revalidatePath("/admin");
  return actionOk("Updated.");
}

/**
 * Admin's "change this and future cleanings" for the universal calendar —
 * same single authoritative domain path (replanRecurringCadence) as the
 * portal's own cadence-change request, for either payment model.
 */
export async function editRecurringCadenceAction(_prevState: ActionResult | null, formData: FormData): Promise<ActionResult> {
  await requireAdmin();
  const repo = createSupabaseSchedulingRepository();

  const recurringScheduleId = String(formData.get("recurringScheduleId") ?? "");
  const effectiveFromVisitNumber = Number(formData.get("effectiveFromVisitNumber") ?? "0");
  const newCadenceRaw = String(formData.get("newCadence") ?? "");
  const newFirstDate = String(formData.get("newFirstDate") ?? "");
  const newFirstStartTime = String(formData.get("newFirstStartTime") ?? "");

  if (!recurringScheduleId || !effectiveFromVisitNumber || !isValidCadence(newCadenceRaw) || !newFirstDate || !newFirstStartTime) {
    return actionError("Missing required fields.");
  }

  try {
    await replanRecurringCadence(repo, {
      recurringScheduleId,
      effectiveFromVisitNumber,
      newCadence: newCadenceRaw,
      newFirstDate,
      newFirstStartTime,
    });
  } catch (error) {
    if (error instanceof InvalidVisitStateError) return actionError(error.message);
    throw error;
  }

  revalidatePath("/admin");
  return actionOk("Cadence updated.");
}

/**
 * Admin confirms the final Pay Per Cleaning amount for a specific visit —
 * (re)computes the estimate against whatever add-ons are currently
 * selected, then confirms it as final. Refuses to confirm an amount that
 * still requires customer approval (see approveVisitPricingIncreaseAction
 * in the customer portal) — never lets admin silently bypass that gate.
 */
export async function confirmVisitPricingAction(_prevState: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const admin = await requireAdmin();
  const repo = createSupabaseSchedulingRepository();

  const serviceVisitId = String(formData.get("serviceVisitId") ?? "");
  const addOnIds = formData.getAll("addOnIds").map(String) as AddOnId[];
  if (!serviceVisitId) {
    return actionError("Missing visit id.");
  }

  try {
    await estimateVisitPricing(repo, { serviceVisitId, addOnIds }, createSupabaseBookingRepository());
    const confirmed = await confirmVisitPricing(repo, { serviceVisitId, confirmedBy: `admin:${admin.adminUserId}` });
    revalidatePath("/admin");
    return actionOk(`Confirmed at $${confirmed.totalAmount.toFixed(2)}.`);
  } catch (error) {
    if (error instanceof InvalidVisitStateError || error instanceof SchedulingConflictError) {
      return actionError(error.message);
    }
    throw error;
  }
}
