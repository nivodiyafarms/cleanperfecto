"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin/require-admin";
import { retryFailedNotification } from "@/lib/notifications/retry-failed-notification";
import { InvalidVisitStateError } from "@/lib/scheduling/errors";
import { createSupabaseSchedulingRepository } from "@/lib/scheduling/supabase-scheduling-repository";
import { actionError, actionOk, type ActionResult } from "./types";

/** Admin's one notification-ledger action: retry a terminal-failed row. No admin dashboard redesign — this is the smallest possible addition, mirroring editRecurringVisitDateAction's shape. */
export async function retryNotificationAction(_prevState: ActionResult | null, formData: FormData): Promise<ActionResult> {
  await requireAdmin();
  const repo = createSupabaseSchedulingRepository();

  const notificationId = String(formData.get("notificationId") ?? "");
  if (!notificationId) {
    return actionError("Missing notification id.");
  }

  try {
    await retryFailedNotification(repo, notificationId);
  } catch (error) {
    if (error instanceof InvalidVisitStateError) return actionError(error.message);
    throw error;
  }

  revalidatePath("/admin");
  return actionOk("Queued for retry.");
}
