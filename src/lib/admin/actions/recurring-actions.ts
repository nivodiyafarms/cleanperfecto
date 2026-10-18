"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin/require-admin";
import { resolveRecurringSchedulingContext } from "@/lib/admin/queries/visit-scope";
import type { AddOnId } from "@/lib/pricing/types";
import { createSupabaseBookingRepository } from "@/lib/booking/supabase-booking-repository";
import { confirmVisitPricing } from "@/lib/scheduling/confirm-visit-pricing";
import { InvalidVisitStateError, SchedulingConflictError } from "@/lib/scheduling/errors";
import { estimateVisitPricing } from "@/lib/scheduling/estimate-visit-pricing";
import { replanRecurringCadence } from "@/lib/scheduling/replan-recurring-cadence";
import { replanRecurringVisit } from "@/lib/scheduling/replan-recurring-visit";
import { scheduleRecurringVisitPlan } from "@/lib/scheduling/schedule-recurring-visit-plan";
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
 * Admin's "Schedule this visit" for a planned (never-yet-linked) universal
 * calendar occurrence — surfaced on the admin Schedule calendar (Day/Week
 * views) alongside real visits. The exact parallel of
 * schedulePackageVisitPlanAction for the non-package (Pay Per Cleaning)
 * recurring path: turns a planning-stage plan into a real 'requested'
 * service_visit via the existing, already-tested scheduleRecurringVisitPlan
 * domain function — the only thing that ever links a plan to an
 * operational visit. Creates a 'requested' visit only (no time/cleaner
 * confirmation, no availability check here) — admin still confirms it via
 * the normal existing Requests queue flow afterward, which already does
 * the cleaner-availability check. Idempotent: a plan already linked
 * returns its existing visit rather than creating a second one.
 */
export async function scheduleRecurringVisitPlanAction(_prevState: ActionResult | null, formData: FormData): Promise<ActionResult> {
  await requireAdmin();
  const recurringVisitPlanId = String(formData.get("recurringVisitPlanId") ?? "");
  const recurringScheduleId = String(formData.get("recurringScheduleId") ?? "");
  if (!recurringVisitPlanId || !recurringScheduleId) {
    return actionError("Plan not found.");
  }

  const context = await resolveRecurringSchedulingContext(recurringScheduleId);
  if (!context) return actionError("Could not resolve this schedule's originating booking.");

  const repo = createSupabaseSchedulingRepository();
  try {
    const result = await scheduleRecurringVisitPlan(repo, {
      recurringVisitPlanId,
      // Derived server-side from the schedule's own booking order, never
      // trusted from the client — same discipline as
      // schedulePackageVisitPlanAction's context.customerId.
      customerId: context.customerId,
      cleaningType: context.cleaningType,
      serviceAddressLine1: context.serviceAddressLine1,
      serviceAddressLine2: context.serviceAddressLine2,
      serviceCity: context.serviceCity,
      serviceState: context.serviceState,
      serviceAddressIdentity: context.serviceAddressIdentity,
      timezone: context.timezone,
    });

    revalidatePath("/admin");
    revalidatePath(`/admin/visits/${result.visitId}`);
    return actionOk(result.alreadyLinked ? "This plan was already linked to a visit." : "Visit scheduled from plan.");
  } catch (error) {
    if (error instanceof InvalidVisitStateError) return actionError(error.message);
    throw error;
  }
}

/**
 * Admin confirms the final Pay Per Cleaning amount for a specific visit —
 * (re)computes the estimate against whatever add-ons are currently
 * selected, then confirms it as final. Pay Per Cleaning has no separate
 * customer price-change approval step (owner-approved product decision,
 * 2026-09-26) — this always succeeds, whatever the recomputed amount is.
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
