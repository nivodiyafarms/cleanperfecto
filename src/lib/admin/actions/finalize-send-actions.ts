"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin/require-admin";
import { assertCapability } from "@/lib/admin/rbac/capabilities";
import { createSupabaseBookingRepository } from "@/lib/booking/supabase-booking-repository";
import { enqueueNotification } from "@/lib/notifications/enqueue-notification";
import type { AddOnId } from "@/lib/pricing/types";
import { estimateVisitPricing } from "@/lib/scheduling/estimate-visit-pricing";
import { InvalidVisitStateError, SchedulingConflictError } from "@/lib/scheduling/errors";
import { finalizeAndSend } from "@/lib/scheduling/finalize-and-send";
import { createSupabaseSchedulingRepository } from "@/lib/scheduling/supabase-scheduling-repository";
import { actionError, actionOk, type ActionResult } from "./types";

function revalidateVisitPaths(visitId: string): void {
  revalidatePath("/admin");
  revalidatePath("/admin/requests");
  revalidatePath(`/admin/requests/${visitId}`);
  revalidatePath(`/admin/visits/${visitId}`);
}

/**
 * Admin's "Final Scope" step, distinct from confirmVisitPricingAction: this
 * ONLY recomputes the estimate (estimateVisitPricing) and never confirms it,
 * so a scope change that pushes the total over the previously-approved
 * amount is visible (requiresCustomerApproval) without the action itself
 * failing — pricing is deliberately left as-is (estimated or
 * pending_customer_approval) for Finalize & Send to resolve. Only usable
 * once the cleaner has marked the visit work-finished — before that, the
 * existing pre-completion "Confirm final price" section/action remains the
 * right tool.
 */
export async function updateFinalScopeAction(_prevState: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const admin = await requireAdmin();
  assertCapability(admin.role, "complete_service_visit");
  const serviceVisitId = String(formData.get("serviceVisitId") ?? "");
  const addOnIds = formData.getAll("addOnIds").map(String) as AddOnId[];
  if (!serviceVisitId) return actionError("Missing visit id.");

  const repo = createSupabaseSchedulingRepository();
  const visit = await repo.findServiceVisitById(serviceVisitId);
  if (!visit) return actionError("Visit not found.");
  if (visit.status !== "work_finished") {
    return actionError("Final scope can only be updated after work is marked finished.");
  }

  try {
    const pricing = await estimateVisitPricing(repo, { serviceVisitId, addOnIds }, createSupabaseBookingRepository());
    revalidateVisitPaths(serviceVisitId);
    return actionOk(
      pricing.requiresCustomerApproval
        ? `Final scope updated — $${pricing.totalAmount.toFixed(2)}, exceeds the previously approved $${pricing.previouslyApprovedAmount?.toFixed(2) ?? "0.00"}. Customer approval will be required.`
        : `Final scope updated — $${pricing.totalAmount.toFixed(2)}. No customer approval needed.`
    );
  } catch (error) {
    if (error instanceof InvalidVisitStateError) return actionError(error.message);
    throw error;
  }
}

/**
 * The one primary admin action. See finalize-and-send.ts for the full
 * sequencing and idempotency rationale — this wrapper only does RBAC,
 * form parsing, and translating the result into a user-facing message.
 */
export async function finalizeAndSendAction(_prevState: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const admin = await requireAdmin();
  assertCapability(admin.role, "complete_service_visit");
  const serviceVisitId = String(formData.get("serviceVisitId") ?? "");
  if (!serviceVisitId) return actionError("Missing visit id.");

  const repo = createSupabaseSchedulingRepository();
  try {
    const result = await finalizeAndSend(repo, createSupabaseBookingRepository(), {
      serviceVisitId,
      actor: `admin:${admin.adminUserId}`,
    });
    revalidateVisitPaths(serviceVisitId);
    revalidatePath("/admin/packages");

    if (result.alreadySent) {
      return actionOk("Final Total was already sent for this visit — use Resend if the customer needs the link again.");
    }
    return actionOk(
      result.requiresCustomerApproval
        ? `Sent — final total $${result.pricing?.totalAmount.toFixed(2)} exceeds the previously approved amount, so the customer will approve and pay in one step.`
        : `Sent — final total $${result.pricing?.totalAmount.toFixed(2)}.`
    );
  } catch (error) {
    if (error instanceof InvalidVisitStateError || error instanceof SchedulingConflictError) {
      return actionError(error.message);
    }
    throw error;
  }
}

/**
 * Reuses the exact same visit/payment destination and notification type as
 * the original Finalize & Send — never creates a new pricing record,
 * PaymentIntent, or service_visit_payments row. Uses a fresh, timestamped
 * versionKey specifically so its idempotency key never collides with the
 * original send's (which is keyed on the final total) — an admin resend is
 * an intentional, auditable action, not a silently-deduplicated retry.
 */
export async function resendFinalTotalLinkAction(_prevState: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const admin = await requireAdmin();
  assertCapability(admin.role, "complete_service_visit");
  const serviceVisitId = String(formData.get("serviceVisitId") ?? "");
  if (!serviceVisitId) return actionError("Missing visit id.");

  const repo = createSupabaseSchedulingRepository();
  const visit = await repo.findServiceVisitById(serviceVisitId);
  if (!visit) return actionError("Visit not found.");

  // "Already sent" is defined by a prior final_total_ready notification
  // existing — not by visit.status, since a visit awaiting the customer's
  // own price-increase approval is deliberately still 'work_finished' (see
  // finalize-and-send.ts) despite Final Total already having been sent.
  const notifications = await repo.listServiceVisitNotifications(serviceVisitId);
  const alreadySent = notifications.some((n) => n.notificationType === "final_total_ready");
  if (!alreadySent) {
    return actionError("Final Total has not been sent yet for this visit — use Finalize & Send first.");
  }

  await repo.insertServiceVisitEvent({
    serviceVisitId,
    eventType: "final_total_sent",
    actor: `admin:${admin.adminUserId}`,
    previousState: null,
    newState: { resend: true },
    notes: "Resend Final Total Link",
  });

  await enqueueNotification(repo, {
    serviceVisitId,
    customerId: visit.customerId,
    notificationType: "final_total_ready",
    channel: "email",
    scheduledSendAt: new Date(),
    versionKey: `resend:${Date.now()}`,
  });

  revalidateVisitPaths(serviceVisitId);
  return actionOk("Final Total link resent.");
}
