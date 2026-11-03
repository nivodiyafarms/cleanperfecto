"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin/require-admin";
import { assertCanManageReferralProgram } from "@/lib/referrals/authorize";
import {
  assertRecipientLabelCodeType,
  normalizeRecipientLabel,
  RecipientLabelTooLongError,
  RecipientLabelTypeError,
} from "@/lib/referrals/recipient-label";
import { createSupabaseReferralRepository } from "@/lib/referrals/supabase-referral-repository";
import { actionError, actionOk, type ActionResult } from "./types";

function formText(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value : "";
}

export async function loadAdminReferralSnapshot() {
  const admin = await requireAdmin();
  assertCanManageReferralProgram(admin.role);
  return createSupabaseReferralRepository().adminSnapshot();
}

export async function issueAdminReferralCodeAction(_prevState: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const admin = await requireAdmin();
  assertCanManageReferralProgram(admin.role);
  let recipientLabel: string | null;
  try {
    recipientLabel = normalizeRecipientLabel(formText(formData.get("recipientLabel")));
  } catch (error) {
    if (error instanceof RecipientLabelTooLongError) {
      return actionError("Given to must be 120 characters or fewer.");
    }
    throw error;
  }
  try {
    const code = await createSupabaseReferralRepository().issueAdminCode(admin.adminUserId, recipientLabel);
    revalidatePath("/admin/referrals");
    return actionOk(`Issued code ${code}.`);
  } catch {
    return actionError("The referral code could not be issued.");
  }
}

export async function updateReferralCodeRecipientLabelAction(
  _prevState: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const admin = await requireAdmin();
  assertCanManageReferralProgram(admin.role);
  const codeId = formText(formData.get("codeId")).trim();
  if (!codeId) return actionError("Choose a referral code.");
  let recipientLabel: string | null;
  try {
    recipientLabel = normalizeRecipientLabel(formText(formData.get("recipientLabel")));
  } catch (error) {
    if (error instanceof RecipientLabelTooLongError) {
      return actionError("Given to must be 120 characters or fewer.");
    }
    throw error;
  }

  const repository = createSupabaseReferralRepository();
  try {
    const codeType = await repository.referralCodeType(codeId);
    if (!codeType) return actionError("Choose a referral code.");
    assertRecipientLabelCodeType(codeType);
  } catch (error) {
    if (error instanceof RecipientLabelTypeError) {
      return actionError("A recipient can only be recorded on a Type B code.");
    }
    return actionError("The recipient could not be updated.");
  }

  try {
    await repository.updateRecipientLabel(codeId, admin.adminUserId, recipientLabel);
    revalidatePath("/admin/referrals");
    return actionOk("Recipient updated.");
  } catch {
    return actionError("The recipient could not be updated.");
  }
}

export async function setReferralCodeActiveAction(_prevState: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const admin = await requireAdmin();
  assertCanManageReferralProgram(admin.role);
  const codeId = formText(formData.get("codeId")).trim();
  const active = formText(formData.get("active")) === "true";
  const reason = formText(formData.get("reason")).trim() || null;
  if (!codeId) return actionError("Choose a referral code.");
  try {
    await createSupabaseReferralRepository().setCodeActive(codeId, active, admin.adminUserId, reason);
    revalidatePath("/admin/referrals");
    return actionOk(active ? "Code enabled." : "Code disabled.");
  } catch {
    return actionError("The referral code could not be updated.");
  }
}
