"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin/require-admin";
import { assertCapability } from "@/lib/admin/rbac/capabilities";
import { createSupabaseSchedulingRepository } from "@/lib/scheduling/supabase-scheduling-repository";
import { InvalidVisitStateError } from "@/lib/scheduling/errors";
import { createStripeVisitPaymentGateway } from "@/lib/payments/visit-payment-gateway";
import { recordExternalPayment } from "@/lib/payments/record-external-payment";
import { collectServiceFeeExternally } from "@/lib/payments/collect-service-fee";
import { refundPrepaidPackage } from "@/lib/payments/refund-prepaid-package";
import { refundVisitPayment } from "@/lib/payments/refund-visit-payment";
import { retryExternalTaxSync } from "@/lib/payments/retry-external-tax-sync";
import { retryTaxReversal } from "@/lib/payments/retry-tax-reversal";
import { createSupabaseBookingRepository } from "@/lib/booking/supabase-booking-repository";
import { actionError, actionOk, type ActionResult } from "./types";

/**
 * Admin "Record External Payment" — the amount is never admin-entered
 * (recordExternalPayment reads only the already-frozen-or-about-to-freeze
 * server-authoritative total); admin only confirms the rail and an
 * optional admin-only reference/note.
 */
export async function recordExternalPaymentAction(_prevState: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const admin = await requireAdmin();
  // Explicitly operations-permitted: "record a GENUINE external Zelle/Cash
  // receipt ONLY through the existing frozen/system-derived amount flow" —
  // recordExternalPayment() below never accepts an admin-entered amount.
  assertCapability(admin.role, "record_external_payment");
  const repo = createSupabaseSchedulingRepository();
  const gateway = createStripeVisitPaymentGateway();

  const serviceVisitId = String(formData.get("serviceVisitId") ?? "");
  const paymentMethodType = String(formData.get("paymentMethodType") ?? "");
  const externalPaymentReference = String(formData.get("externalPaymentReference") ?? "").trim() || null;
  if (!serviceVisitId || (paymentMethodType !== "zelle" && paymentMethodType !== "cash")) {
    return actionError("Choose Zelle or Cash.");
  }

  try {
    // The payment settlement and its financial-audit actor record commit
    // together, atomically, inside recordExternalPayment ->
    // recordExternalServiceVisitPaymentWithAudit — see that function's
    // doc comment. There is no separate post-hoc audit write here: if the
    // audit half of that single transaction fails, the whole call throws
    // and the payment is never left settled without one.
    await recordExternalPayment(repo, gateway, {
      serviceVisitId,
      paymentMethodType,
      externalPaymentReference,
      actorAdminUserId: admin.adminUserId,
      actorRole: admin.role,
    });
  } catch (error) {
    if (error instanceof InvalidVisitStateError) return actionError(error.message);
    throw error;
  }

  revalidatePath("/admin");
  return actionOk("Payment recorded.");
}

/**
 * Admin "Retry Tax Sync" — only ever retries the missing Stripe Tax
 * Transaction, never the payment fact itself.
 *
 * Phase 2 RBAC classification: AMBIGUOUS, left as any-admin (unchanged)
 * rather than restricted. This is mechanical reconciliation with no
 * discretion — it can never alter the frozen payment amount, and
 * retryExternalTaxSync fails closed (never silently reconciles) on any
 * mismatch — so it doesn't clearly match either "routine operational
 * action" or the "privileged reconciliation" the spec reserves for
 * owner_admin. Per instruction, an ambiguous case is preserved as-is and
 * classified here rather than given an arbitrary new restriction.
 */
export async function retryTaxSyncAction(_prevState: ActionResult | null, formData: FormData): Promise<ActionResult> {
  await requireAdmin();
  const repo = createSupabaseSchedulingRepository();
  const gateway = createStripeVisitPaymentGateway();

  const serviceVisitPaymentId = String(formData.get("serviceVisitPaymentId") ?? "");
  if (!serviceVisitPaymentId) return actionError("Missing payment id.");

  try {
    await retryExternalTaxSync(repo, gateway, serviceVisitPaymentId);
  } catch (error) {
    if (error instanceof InvalidVisitStateError) return actionError(error.message);
    throw error;
  }

  revalidatePath("/admin");
  return actionOk("Tax sync retried.");
}

/**
 * Admin "Issue Refund" — owner-only (a refund is a financial waiver/
 * correction in the same category as fee waivers, never operations —
 * see AdminCapability's "issue_refund"). The Stripe refund call and the
 * local financial-audit-attributed state transition both happen inside
 * refundVisitPayment; the admin only supplies the amount (full or
 * partial, admin-entered here since — unlike recordExternalPayment's
 * frozen/system-derived amount — a refund amount is inherently a
 * judgment call the admin makes) and a reason.
 */
export async function refundPaymentAction(_prevState: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const admin = await requireAdmin();
  assertCapability(admin.role, "issue_refund");
  const repo = createSupabaseSchedulingRepository();
  const gateway = createStripeVisitPaymentGateway();

  const serviceVisitId = String(formData.get("serviceVisitId") ?? "");
  const refundAmount = Number(formData.get("refundAmount") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!serviceVisitId) return actionError("Missing visit id.");
  if (!Number.isFinite(refundAmount) || refundAmount <= 0) return actionError("Enter a valid refund amount greater than $0.");
  if (!reason) return actionError("A reason is required for a refund.");

  try {
    await refundVisitPayment(repo, gateway, {
      serviceVisitId,
      refundAmount,
      reason,
      actorAdminUserId: admin.adminUserId,
      actorRole: admin.role,
    });
  } catch (error) {
    if (error instanceof InvalidVisitStateError) return actionError(error.message);
    throw error;
  }

  revalidatePath("/admin");
  return actionOk("Refund issued.");
}

/**
 * Admin "Cancel Prepaid Package (Refund Unused Credits)" — owner-only,
 * same capability as the per-visit refund above. The refund amount is
 * never admin-entered: it is entirely computed by refundPrepaidPackage
 * from the immutable original package_total_paid snapshot per the
 * finalized cancellation policy, so there is no amount field to trust or
 * validate here — only the target package id and a reason.
 */
export async function refundPrepaidPackageAction(_prevState: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const admin = await requireAdmin();
  assertCapability(admin.role, "issue_refund");
  const schedulingRepo = createSupabaseSchedulingRepository();
  const bookingRepo = createSupabaseBookingRepository();
  const gateway = createStripeVisitPaymentGateway();

  const prepaidPackageId = String(formData.get("prepaidPackageId") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!prepaidPackageId) return actionError("Missing package id.");
  if (!reason) return actionError("A reason is required for a package cancellation.");

  try {
    const { refundAmount } = await refundPrepaidPackage(schedulingRepo, bookingRepo, gateway, {
      prepaidPackageId,
      reason,
      actorAdminUserId: admin.adminUserId,
      actorRole: admin.role,
    });
    revalidatePath("/admin");
    return actionOk(refundAmount > 0 ? `Package cancelled. $${refundAmount.toFixed(2)} refunded.` : "Package cancelled. No unused credits remained to refund.");
  } catch (error) {
    if (error instanceof InvalidVisitStateError) return actionError(error.message);
    throw error;
  }
}

/**
 * Admin "Retry Tax Reversal" — Phase F.1. Owner-only (same capability as
 * issuing the refund itself — this action exists entirely to finish
 * reconciling an already-issued refund's Stripe Tax bookkeeping, never to
 * move money). Idempotent: retrying an already-succeeded reconciliation
 * is a safe no-op (see retryTaxReversal / attemptTaxReversal).
 */
export async function retryTaxReversalAction(_prevState: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const admin = await requireAdmin();
  assertCapability(admin.role, "issue_refund");
  const repo = createSupabaseSchedulingRepository();
  const gateway = createStripeVisitPaymentGateway();

  const reconciliationId = String(formData.get("reconciliationId") ?? "");
  if (!reconciliationId) return actionError("Missing reconciliation id.");

  try {
    const result = await retryTaxReversal(repo, gateway, {
      reconciliationId,
      actorAdminUserId: admin.adminUserId,
      actorRole: admin.role,
    });
    revalidatePath("/admin");
    if (result.status === "succeeded") return actionOk("Tax reversal reconciled.");
    return actionError(`Tax reversal still failing: ${result.failureMessage ?? "unknown error"}`);
  } catch (error) {
    if (error instanceof InvalidVisitStateError) return actionError(error.message);
    throw error;
  }
}

/**
 * Admin "Record Fee Collection" — Phase H. Same capability as recording an
 * external visit payment (record_external_payment, operations-permitted):
 * this is a routine "confirm an already-happened external settlement"
 * action, never a judgment call like waiving a fee, and never an
 * admin-entered amount — the fee's own frozen amount is always what gets
 * collected.
 */
export async function collectServiceFeeAction(_prevState: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const admin = await requireAdmin();
  assertCapability(admin.role, "record_external_payment");
  const repo = createSupabaseSchedulingRepository();

  const feeAssessmentId = String(formData.get("feeAssessmentId") ?? "");
  const collectionMethod = String(formData.get("collectionMethod") ?? "");
  const externalPaymentReference = String(formData.get("externalPaymentReference") ?? "").trim() || null;
  if (!feeAssessmentId || (collectionMethod !== "zelle" && collectionMethod !== "cash")) {
    return actionError("Choose Zelle or Cash.");
  }

  try {
    await collectServiceFeeExternally(repo, {
      feeAssessmentId,
      collectionMethod,
      externalPaymentReference,
      actorAdminUserId: admin.adminUserId,
      actorRole: admin.role,
    });
  } catch (error) {
    if (error instanceof InvalidVisitStateError) return actionError(error.message);
    throw error;
  }

  revalidatePath("/admin");
  return actionOk("Fee collection recorded.");
}
