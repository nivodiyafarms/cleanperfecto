"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin/require-admin";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { actionError, actionOk, type ActionResult } from "./types";

/**
 * scheduling_day_overrides CRUD. No delete grant exists on this table
 * (same "status change, not deletion" convention as every other table in
 * this schema), so "remove/reopen" a block is implemented as editing it
 * (e.g. narrowing a partial block, or correcting a mistaken date/reason) —
 * not a hard delete. Never writes a 'full' value anywhere: capacity being
 * full is always a dynamic finding of the availability engine, never a
 * stored override type — see the migration's own comment.
 */
export async function addDayOverrideAction(_prevState: ActionResult | null, formData: FormData): Promise<ActionResult> {
  await requireAdmin();
  const overrideDate = String(formData.get("overrideDate") ?? "");
  const type = String(formData.get("type") ?? "");
  const blockStartTime = String(formData.get("blockStartTime") ?? "") || null;
  const blockEndTime = String(formData.get("blockEndTime") ?? "") || null;
  const reason = String(formData.get("reason") ?? "").trim() || null;

  if (!overrideDate) return actionError("Choose a date.");
  if (type !== "closed_all_day" && type !== "partial_block") return actionError("Choose a valid block type.");
  if (type === "partial_block" && (!blockStartTime || !blockEndTime)) {
    return actionError("A partial-day block needs both a start and end time.");
  }
  if (type === "partial_block" && blockEndTime! <= blockStartTime!) {
    return actionError("End time must be after start time.");
  }

  const supabase = createSupabaseAdminClient();
  const { error } = await supabase.from("scheduling_day_overrides").insert({
    override_date: overrideDate,
    type,
    block_start_time: type === "partial_block" ? blockStartTime : null,
    block_end_time: type === "partial_block" ? blockEndTime : null,
    reason,
  });
  if (error) {
    if (error.code === "23505") {
      return actionError("This date already has a full-day closure recorded.");
    }
    return actionError(`Could not add block: ${error.message}`);
  }

  revalidatePath("/admin/availability");
  return actionOk("Scheduling block added.");
}

export async function updateDayOverrideAction(_prevState: ActionResult | null, formData: FormData): Promise<ActionResult> {
  await requireAdmin();
  const overrideId = String(formData.get("overrideId") ?? "");
  const blockStartTime = String(formData.get("blockStartTime") ?? "") || null;
  const blockEndTime = String(formData.get("blockEndTime") ?? "") || null;
  const reason = String(formData.get("reason") ?? "").trim() || null;

  if (!overrideId) return actionError("Block not found.");
  if (blockStartTime && blockEndTime && blockEndTime <= blockStartTime) {
    return actionError("End time must be after start time.");
  }

  const supabase = createSupabaseAdminClient();
  const { error } = await supabase
    .from("scheduling_day_overrides")
    .update({ block_start_time: blockStartTime, block_end_time: blockEndTime, reason })
    .eq("id", overrideId)
    .eq("type", "partial_block"); // a closed_all_day row has no times to edit — only its reason, handled separately if needed.
  if (error) return actionError(`Could not update block: ${error.message}`);

  revalidatePath("/admin/availability");
  return actionOk("Scheduling block updated.");
}
