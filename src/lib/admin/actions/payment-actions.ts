"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin/require-admin";
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
  await requireAdmin();
  const repo = createSupabaseSchedulingRepository();
  const gateway = createStripeVisitPaymentGateway();

  const serviceVisitId = String(formData.get("serviceVisitId") ?? "");
  const paymentMethodType = String(formData.get("paymentMethodType") ?? "");
  const externalPaymentReference = String(formData.get("externalPaymentReference") ?? "").trim() || null;
  if (!serviceVisitId || (paymentMethodType !== "zelle" && paymentMethodType !== "cash")) {
    return actionError("Choose Zelle or Cash.");
  }

  try {
    await recordExternalPayment(repo, gateway, { serviceVisitId, paymentMethodType, externalPaymentReference });
  } catch (error) {
    if (error instanceof InvalidVisitStateError) return actionError(error.message);
    throw error;
  }

  revalidatePath("/admin");
  return actionOk("Payment recorded.");
}

/** Admin "Retry Tax Sync" — only ever retries the missing Stripe Tax Transaction, never the payment fact itself. */
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
