"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin/require-admin";
import { assertCanManageReferralProgram } from "@/lib/referrals/authorize";
import { createSupabaseReferralRepository } from "@/lib/referrals/supabase-referral-repository";
import { actionError, actionOk, type ActionResult } from "./types";

export async function issueAdminReferralCodeAction(_prevState: ActionResult | null, formData: FormData): Promise<ActionResult> {
  void formData;
  const admin = await requireAdmin();
  assertCanManageReferralProgram(admin.role);
  try {
    const code = await createSupabaseReferralRepository().issueAdminCode(admin.adminUserId);
    revalidatePath("/admin/referrals");
    return actionOk(`Issued code ${code}.`);
  } catch {
    return actionError("The referral code could not be issued.");
  }
}

export async function setReferralCodeActiveAction(_prevState: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const admin = await requireAdmin();
  assertCanManageReferralProgram(admin.role);
  const codeId = String(formData.get("codeId") ?? "");
  const active = String(formData.get("active") ?? "") === "true";
  const reason = String(formData.get("reason") ?? "").trim() || null;
  if (!codeId) return actionError("Choose a referral code.");
  try {
    await createSupabaseReferralRepository().setCodeActive(codeId, active, admin.adminUserId, reason);
    revalidatePath("/admin/referrals");
    return actionOk(active ? "Code enabled." : "Code disabled.");
  } catch {
    return actionError("The referral code could not be updated.");
  }
}
