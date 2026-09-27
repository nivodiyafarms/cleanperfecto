"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin/require-admin";
import { assertCapability } from "@/lib/admin/rbac/capabilities";
import { createSupabaseBookingRepository } from "@/lib/booking/supabase-booking-repository";
import { enqueueNotification } from "@/lib/notifications/enqueue-notification";
import type { AddOnId } from "@/lib/pricing/types";
import { addCustomPricingAdjustment } from "@/lib/scheduling/add-custom-pricing-adjustment";
import { estimateVisitPricing } from "@/lib/scheduling/estimate-visit-pricing";
import { InvalidVisitStateError, SchedulingConflictError } from "@/lib/scheduling/errors";
import { finalizeAndSend } from "@/lib/scheduling/finalize-and-send";
import { removeCustomPricingAdjustment } from "@/lib/scheduling/remove-custom-pricing-adjustment";
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

/** Positive, finite, at most 2 decimal places — a real currency amount, never NaN/Infinity/negative/zero. Returns null for anything else, so callers never have to separately guard against a garbage string reaching the domain layer. */
function parsePositiveCurrencyAmount(raw: FormDataEntryValue | null): number | null {
  const value = Number(String(raw ?? "").trim());
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(value * 100) / 100;
}

/**
 * Admin "Custom Charge" — same capability as the predefined final-scope
 * add-on checklist (updateFinalScopeAction): an operations admin may add
 * one, same as they may already select "Oven Interior" or any other
 * catalog extra. See add-custom-pricing-adjustment.ts for the full
 * sequencing.
 */
export async function addCustomChargeAction(_prevState: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const admin = await requireAdmin();
  assertCapability(admin.role, "complete_service_visit");
  return runAddCustomAdjustment(admin, formData, "custom_charge");
}

/**
 * Admin "Custom Discount / Credit" — a financial correction, OWNER-ONLY
 * (assertCapability("financial_correction")), consistent with every other
 * owner-only financial-correction rule in this codebase. An operations
 * admin's request is rejected here regardless of what the submitting form
 * looked like — the UI hiding/disabling this control for non-owners is a
 * courtesy, never the actual authorization boundary.
 */
export async function addCustomDiscountAction(_prevState: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const admin = await requireAdmin();
  assertCapability(admin.role, "financial_correction");
  return runAddCustomAdjustment(admin, formData, "custom_discount");
}

async function runAddCustomAdjustment(
  admin: { adminUserId: string; role: string },
  formData: FormData,
  type: "custom_charge" | "custom_discount"
): Promise<ActionResult> {
  const serviceVisitId = String(formData.get("serviceVisitId") ?? "");
  const description = String(formData.get("description") ?? "").trim();
  const amount = parsePositiveCurrencyAmount(formData.get("amount"));
  if (!serviceVisitId) return actionError("Missing visit id.");
  if (!description) return actionError("A reason/description is required.");
  if (amount === null) {
    return actionError(type === "custom_charge" ? "Enter a valid amount greater than $0." : "Enter a valid discount/credit amount greater than $0.");
  }

  const repo = createSupabaseSchedulingRepository();
  try {
    const pricing = await addCustomPricingAdjustment(repo, createSupabaseBookingRepository(), {
      serviceVisitId,
      type,
      description,
      amount,
      actorAdminUserId: admin.adminUserId,
      actorRole: admin.role,
    });
    revalidateVisitPaths(serviceVisitId);
    return actionOk(
      type === "custom_charge"
        ? `Custom charge added — new estimate $${pricing.totalAmount.toFixed(2)}.`
        : `Custom discount/credit added — new estimate $${pricing.totalAmount.toFixed(2)}.`
    );
  } catch (error) {
    if (error instanceof InvalidVisitStateError) return actionError(error.message);
    // The RPC's own guards (non-positive amount, blank description, a
    // discount that would drive the payable amount below $0) surface as a
    // plain Error — see add_custom_pricing_adjustment_with_audit's own
    // comment. These are genuine input-rejection outcomes, not bugs.
    if (error instanceof Error) return actionError(error.message);
    throw error;
  }
}

/** Admin removes a not-yet-sent custom charge — same capability as adding one. */
export async function removeCustomChargeAction(_prevState: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const admin = await requireAdmin();
  assertCapability(admin.role, "complete_service_visit");
  return runRemoveCustomAdjustment(admin, formData);
}

/** Admin removes a not-yet-sent custom discount/credit — owner-only, same as adding one. */
export async function removeCustomDiscountAction(_prevState: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const admin = await requireAdmin();
  assertCapability(admin.role, "financial_correction");
  return runRemoveCustomAdjustment(admin, formData);
}

async function runRemoveCustomAdjustment(admin: { adminUserId: string; role: string }, formData: FormData): Promise<ActionResult> {
  const serviceVisitId = String(formData.get("serviceVisitId") ?? "");
  const adjustmentId = String(formData.get("adjustmentId") ?? "");
  if (!serviceVisitId || !adjustmentId) return actionError("Missing visit id or adjustment id.");

  const repo = createSupabaseSchedulingRepository();
  try {
    const pricing = await removeCustomPricingAdjustment(repo, createSupabaseBookingRepository(), {
      serviceVisitId,
      adjustmentId,
      actorAdminUserId: admin.adminUserId,
      actorRole: admin.role,
    });
    revalidateVisitPaths(serviceVisitId);
    return actionOk(`Removed — new estimate $${pricing.totalAmount.toFixed(2)}.`);
  } catch (error) {
    if (error instanceof InvalidVisitStateError) return actionError(error.message);
    if (error instanceof Error) return actionError(error.message);
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
