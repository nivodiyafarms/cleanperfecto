"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin/require-admin";
import { assertCapability } from "@/lib/admin/rbac/capabilities";
import { createSupabaseSchedulingRepository } from "@/lib/scheduling/supabase-scheduling-repository";
import { InvalidVisitStateError } from "@/lib/scheduling/errors";
import { createStripeVisitPaymentGateway } from "@/lib/payments/visit-payment-gateway";
import { recordExternalPayment } from "@/lib/payments/record-external-payment";
import { retryExternalTaxSync } from "@/lib/payments/retry-external-tax-sync";
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
