"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin/require-admin";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { actionError, actionOk, type ActionResult } from "./types";

const DAY_OF_WEEK_RANGE = [0, 1, 2, 3, 4, 5, 6];

/**
 * Plain CRUD on cleaners / cleaner_availability_rules /
 * cleaner_availability_exceptions — these tables carry no workflow beyond
 * "admin edits a row," so they're written directly via the existing
 * service-role admin client (same client every other read/write in this
 * app already uses) rather than added to SchedulingRepository, which
 * exists specifically for the scheduling domain functions' unit-test seam
 * (see that interface's own comment) — none of these simple writes are
 * ever consumed by a domain function.
 */
export async function addCleanerAction(_prevState: ActionResult | null, formData: FormData): Promise<ActionResult> {
  await requireAdmin();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return actionError("Name is required.");

  const supabase = createSupabaseAdminClient();
  const { error } = await supabase.from("cleaners").insert({ name });
  if (error) return actionError(`Could not add cleaner: ${error.message}`);

  revalidatePath("/admin/cleaners");
  return actionOk("Cleaner added.");
}

export async function setCleanerActiveAction(_prevState: ActionResult | null, formData: FormData): Promise<ActionResult> {
  await requireAdmin();
  const cleanerId = String(formData.get("cleanerId") ?? "");
  const active = formData.get("active") === "true";
  if (!cleanerId) return actionError("Cleaner not found.");

  const supabase = createSupabaseAdminClient();
  const { error } = await supabase.from("cleaners").update({ active }).eq("id", cleanerId);
  if (error) return actionError(`Could not update cleaner: ${error.message}`);

  revalidatePath("/admin/cleaners");
  revalidatePath(`/admin/cleaners/${cleanerId}`);
  return actionOk(active ? "Cleaner activated." : "Cleaner deactivated.");
}

export async function addAvailabilityRuleAction(_prevState: ActionResult | null, formData: FormData): Promise<ActionResult> {
  await requireAdmin();
  const cleanerId = String(formData.get("cleanerId") ?? "");
  const dayOfWeek = Number(formData.get("dayOfWeek"));
  const startTime = String(formData.get("startTime") ?? "");
  const endTime = String(formData.get("endTime") ?? "");

  if (!cleanerId || !DAY_OF_WEEK_RANGE.includes(dayOfWeek) || !startTime || !endTime) {
    return actionError("Choose a day of week and a valid start/end time.");
  }
  if (endTime <= startTime) {
    return actionError("End time must be after start time.");
  }

  const supabase = createSupabaseAdminClient();
  const { error } = await supabase
    .from("cleaner_availability_rules")
    .insert({ cleaner_id: cleanerId, day_of_week: dayOfWeek, start_time: startTime, end_time: endTime });
  if (error) return actionError(`Could not add availability: ${error.message}`);

  revalidatePath(`/admin/cleaners/${cleanerId}`);
  return actionOk("Recurring availability added.");
}

export async function setAvailabilityRuleActiveAction(_prevState: ActionResult | null, formData: FormData): Promise<ActionResult> {
  await requireAdmin();
  const ruleId = String(formData.get("ruleId") ?? "");
  const cleanerId = String(formData.get("cleanerId") ?? "");
  const active = formData.get("active") === "true";
  if (!ruleId) return actionError("Rule not found.");

  const supabase = createSupabaseAdminClient();
  const { error } = await supabase.from("cleaner_availability_rules").update({ active }).eq("id", ruleId);
  if (error) return actionError(`Could not update availability: ${error.message}`);

  if (cleanerId) revalidatePath(`/admin/cleaners/${cleanerId}`);
  return actionOk(active ? "Availability re-enabled." : "Availability disabled.");
}

export async function addAvailabilityExceptionAction(_prevState: ActionResult | null, formData: FormData): Promise<ActionResult> {
  await requireAdmin();
  const cleanerId = String(formData.get("cleanerId") ?? "");
  const exceptionDate = String(formData.get("exceptionDate") ?? "");
  const type = String(formData.get("type") ?? "");
  const startTime = String(formData.get("startTime") ?? "") || null;
  const endTime = String(formData.get("endTime") ?? "") || null;
  const reason = String(formData.get("reason") ?? "").trim() || null;

  if (!cleanerId || !exceptionDate) {
    return actionError("Choose a cleaner and a date.");
  }
  if (type !== "unavailable_all_day" && type !== "custom_hours") {
    return actionError("Choose a valid exception type.");
  }
  if (type === "custom_hours" && (!startTime || !endTime)) {
    return actionError("Custom hours need both a start and end time.");
  }

  const supabase = createSupabaseAdminClient();
  const { error } = await supabase.from("cleaner_availability_exceptions").upsert(
    {
      cleaner_id: cleanerId,
      exception_date: exceptionDate,
      type,
      start_time: type === "custom_hours" ? startTime : null,
      end_time: type === "custom_hours" ? endTime : null,
      reason,
    },
    { onConflict: "cleaner_id,exception_date" }
  );
  if (error) return actionError(`Could not add exception: ${error.message}`);

  revalidatePath(`/admin/cleaners/${cleanerId}`);
  return actionOk("Exception saved.");
}
