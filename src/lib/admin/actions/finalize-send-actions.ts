"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin/require-admin";
import { assertCapability } from "@/lib/admin/rbac/capabilities";
import { createSupabaseBookingRepository } from "@/lib/booking/supabase-booking-repository";
import { createSupabaseCustomerAuthLinkGenerator } from "@/lib/customer-portal/customer-auth-link";
import { requestFreshPaymentLink } from "@/lib/customer-portal/request-fresh-payment-link";
import { getNotificationRecipientContact } from "@/lib/notifications/customer-contact-lookup";
import { createResendNotificationEmailSender } from "@/lib/notifications/resend-notification-email-sender";
import type { AddOnId } from "@/lib/pricing/types";
import { addCustomPricingAdjustment } from "@/lib/scheduling/add-custom-pricing-adjustment";
import { estimateVisitPricing } from "@/lib/scheduling/estimate-visit-pricing";
import { InvalidVisitStateError, SchedulingConflictError } from "@/lib/scheduling/errors";
import { finalizeAndSend } from "@/lib/scheduling/finalize-and-send";
import { removeCustomPricingAdjustment } from "@/lib/scheduling/remove-custom-pricing-adjustment";
import { createSupabaseSchedulingRepository } from "@/lib/scheduling/supabase-scheduling-repository";
import { startVisitPricingRevision } from "@/lib/scheduling/start-visit-pricing-revision";
import { createStripeVisitPaymentGateway } from "@/lib/payments/visit-payment-gateway";
import { actionError, actionOk, type ActionResult } from "./types";

function revalidateVisitPaths(visitId: string): void {
  revalidatePath("/admin");
  revalidatePath("/admin/requests");
  revalidatePath(`/admin/requests/${visitId}`);
  revalidatePath(`/admin/visits/${visitId}`);
}

/**
 * Admin's "Final Scope" step, distinct from confirmVisitPricingAction: this
 * ONLY recomputes the estimate (estimateVisitPricing) and never confirms it
 * — that's Finalize & Send's job. Pay Per Cleaning no longer has a separate
 * customer price-change approval step (owner-approved product decision,
 * 2026-09-26): a scope change that pushes the total up simply reflects in
 * the new estimate, with no approval gate to surface. Only usable once the
 * cleaner has marked the visit work-finished — before that, the existing
 * pre-completion "Confirm final price" section/action remains the right
 * tool.
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
  const existingPricing = await repo.findServiceVisitPricingByVisitId(serviceVisitId);
  const isRevisionInProgress = visit.status === "completed" && existingPricing?.priceStatus === "revision_in_progress";
  if (visit.status !== "work_finished" && !isRevisionInProgress) {
    return actionError("Final scope can only be updated after work is marked finished (or mid-revision — see Revise Final Total).");
  }

  try {
    const pricing = await estimateVisitPricing(repo, { serviceVisitId, addOnIds }, createSupabaseBookingRepository());
    revalidateVisitPaths(serviceVisitId);
    return actionOk(
      pricing.totalAmount !== pricing.baseAmount
        ? `Final scope updated — $${pricing.totalAmount.toFixed(2)} (originally $${pricing.baseAmount.toFixed(2)}).`
        : `Final scope updated — $${pricing.totalAmount.toFixed(2)}.`
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
 * Admin "Revise Final Total" — Feature 2's reopen entry point. Owner-only
 * (financial_correction — same tier as a custom discount/credit, since
 * this can both decrease an already-sent total AND cancels a live Stripe
 * charge). A required reason mirrors refundPaymentAction's own
 * required-reason pattern. Everything downstream of the reopen (adding/
 * removing custom charges, Finalize & Send again) reuses the existing,
 * completely unmodified RBAC for those actions — this action only opens
 * the window.
 */
export async function startVisitPricingRevisionAction(_prevState: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const admin = await requireAdmin();
  assertCapability(admin.role, "financial_correction");
  const serviceVisitId = String(formData.get("serviceVisitId") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!serviceVisitId) return actionError("Missing visit id.");
  if (!reason) return actionError("A reason is required to revise the Final Total.");

  const repo = createSupabaseSchedulingRepository();
  const gateway = createStripeVisitPaymentGateway();
  try {
    await startVisitPricingRevision(repo, gateway, {
      serviceVisitId,
      actorAdminUserId: admin.adminUserId,
      actorRole: admin.role,
      reason,
    });
    revalidateVisitPaths(serviceVisitId);
    return actionOk("Revision started — make your adjustments below, then Finalize & Send again.");
  } catch (error) {
    if (error instanceof InvalidVisitStateError) return actionError(error.message);
    throw error;
  }
}

/**
 * The admin is already authenticated/authorized, so showing the real
 * notification-send failure reason isn't an information-disclosure
 * concern — same rationale as resendFinalTotalLinkAction's own
 * ADMIN_FAILURE_MESSAGE below. Points at the Notifications section's own
 * Retry button (visits/[visitId]/page.tsx) rather than duplicating the
 * underlying reason, which the notification row's own failureReason text
 * already shows there.
 */
const NOTIFICATION_FAILURE_MESSAGE: Record<"no_email_on_file" | "link_generation_failed" | "send_failed", string> = {
  no_email_on_file: "The notification wasn't sent — this customer has no email on file. Add one, then retry it from the Notifications section below.",
  link_generation_failed: "The notification wasn't sent — couldn't generate a secure link after retrying. Retry it from the Notifications section below.",
  send_failed: "The notification wasn't sent after retrying. Retry it from the Notifications section below.",
};

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
    const result = await finalizeAndSend(
      repo,
      createSupabaseBookingRepository(),
      {
        serviceVisitId,
        actor: `admin:${admin.adminUserId}`,
      },
      {
        contactLookup: getNotificationRecipientContact,
        authLinkGenerator: createSupabaseCustomerAuthLinkGenerator(),
        emailSender: createResendNotificationEmailSender(),
      }
    );
    revalidateVisitPaths(serviceVisitId);
    revalidatePath("/admin/packages");

    if (result.alreadySent) {
      return actionOk("Final Total was already sent for this visit — use Resend if the customer needs the link again.");
    }

    const amountLabel =
      result.pricing && result.pricing.totalAmount !== result.pricing.baseAmount
        ? `final total $${result.pricing.totalAmount.toFixed(2)} (originally $${result.pricing.baseAmount.toFixed(2)})`
        : `final total $${result.pricing?.totalAmount.toFixed(2)}`;

    // The visit is genuinely finalized/completed either way (pricing frozen,
    // work_finished -> completed crossed) — only the notification's own
    // outcome varies, so a send failure here is reported as an accurate
    // qualifier, never as an overall action failure that might tempt a
    // confused re-click of Finalize & Send (which would just report
    // alreadySent instead of retrying the notification).
    if (result.notification && !result.notification.ok) {
      return actionOk(`Finalized — ${amountLabel}. ${NOTIFICATION_FAILURE_MESSAGE[result.notification.reason]}`);
    }
    return actionOk(`Sent — ${amountLabel}.`);
  } catch (error) {
    if (error instanceof InvalidVisitStateError || error instanceof SchedulingConflictError) {
      return actionError(error.message);
    }
    throw error;
  }
}

/**
 * Sends immediately — via requestFreshPaymentLink, the SAME shared secure
 * resend logic the unauthenticated customer /my/payment-link-expired page
 * uses — rather than enqueueing for the next 5-minute dispatch-notifications
 * cron sweep. Traced against real production timestamps before this change:
 * an admin resend through the old enqueue-and-wait path took anywhere from
 * well under a minute to just under 5 minutes to actually leave, purely as
 * a function of when the click happened to land relative to the cron's
 * fixed schedule — not a bug, just unnecessary queueing for an action that
 * has no reason to wait. Duplicate protection and rate limiting are
 * enforced inside the shared function, not duplicated here.
 */
export async function resendFinalTotalLinkAction(_prevState: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const admin = await requireAdmin();
  assertCapability(admin.role, "complete_service_visit");
  const serviceVisitId = String(formData.get("serviceVisitId") ?? "");
  if (!serviceVisitId) return actionError("Missing visit id.");

  const repo = createSupabaseSchedulingRepository();

  // "Already sent" is defined by a prior final_total_ready notification
  // existing — not by visit.status, since a visit awaiting the customer's
  // own price-increase approval is deliberately still 'work_finished' (see
  // finalize-and-send.ts) despite Final Total already having been sent.
  const notifications = await repo.listServiceVisitNotifications(serviceVisitId);
  const alreadySent = notifications.some((n) => n.notificationType === "final_total_ready");
  if (!alreadySent) {
    return actionError("Final Total has not been sent yet for this visit — use Finalize & Send first.");
  }

  const result = await requestFreshPaymentLink(
    {
      repo,
      contactLookup: getNotificationRecipientContact,
      authLinkGenerator: createSupabaseCustomerAuthLinkGenerator(),
      emailSender: createResendNotificationEmailSender(),
    },
    serviceVisitId
  );

  await repo.insertServiceVisitEvent({
    serviceVisitId,
    eventType: "final_total_sent",
    actor: `admin:${admin.adminUserId}`,
    previousState: null,
    newState: { resend: true, outcome: result.ok ? "sent" : result.reason },
    notes: "Resend Final Total Link",
  });

  revalidateVisitPaths(serviceVisitId);

  if (result.ok) {
    return actionOk("Sent — the customer's Final Total link went out just now.");
  }

  // The admin is already authenticated/authorized — unlike the
  // unauthenticated customer-facing caller of this same function, showing
  // the real reason here isn't an information-disclosure concern.
  const ADMIN_FAILURE_MESSAGE: Record<Exclude<typeof result.reason, undefined>, string> = {
    visit_not_found: "Visit not found.",
    not_payable: "This visit isn't in a payable state right now (not completed, pricing not confirmed, or already paid).",
    no_email_on_file: "This customer has no email on file — add one before resending.",
    link_generation_failed: "Couldn't generate a secure link just now. Please try again shortly.",
    send_failed: "The email failed to send after retrying. Please try again shortly.",
    duplicate_request: "A resend was already sent moments ago — please wait before trying again.",
    rate_limited: "This visit has reached the resend limit for the past hour — please wait before trying again.",
  };
  return actionError(ADMIN_FAILURE_MESSAGE[result.reason]);
}
