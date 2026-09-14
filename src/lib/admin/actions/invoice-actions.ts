"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin/require-admin";
import { assertCapability } from "@/lib/admin/rbac/capabilities";
import { createSupabaseSchedulingRepository } from "@/lib/scheduling/supabase-scheduling-repository";
import { actionError, actionOk, type ActionResult } from "./types";

/**
 * Admin "Void Invoice" — owner-only (a void is a financial correction, same
 * category as fee waivers/refunds). Voiding never edits the invoice's
 * frozen facts (enforced by the DB trigger regardless); it only flips
 * paymentStatus to 'void' and records why, atomically with its
 * financial_audit_log row, via voidInvoiceWithAudit.
 */
export async function voidInvoiceAction(_prevState: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const admin = await requireAdmin();
  assertCapability(admin.role, "financial_correction");

  const invoiceId = String(formData.get("invoiceId") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!invoiceId) return actionError("Missing invoice id.");
  if (!reason) return actionError("A reason is required to void an invoice.");

  const repo = createSupabaseSchedulingRepository();
  await repo.voidInvoiceWithAudit(invoiceId, reason, { actorAdminUserId: admin.adminUserId, actorRole: admin.role });

  revalidatePath(`/admin/invoices/${invoiceId}`);
  return actionOk("Invoice voided.");
}
