"use server";

import { revalidatePath } from "next/cache";
import { actionError, actionOk, type ActionResult } from "@/lib/admin/actions/types";
import { approveRecurringScopeChange, rejectRecurringScopeChange } from "@/lib/scheduling/approve-recurring-scope-change";
import { approveVisitPricingIncrease } from "@/lib/scheduling/confirm-visit-pricing";
import { InvalidVisitStateError } from "@/lib/scheduling/errors";
import { createSupabaseSchedulingRepository } from "@/lib/scheduling/supabase-scheduling-repository";
import { assertRecurringScopeVersionBelongsToCustomer, assertVisitBelongsToCustomer, CustomerOwnershipError } from "@/lib/customer-portal/ownership";
import { requireCustomer } from "@/lib/customer-portal/require-customer";

/** Customer approves or declines a pending recurring base-scope change (e.g. one more bedroom, Standard -> Deep). Applies to Pay Per Cleaning recurring customers — package cadence changes go through package-actions.ts's respondToPackageAmendmentAction instead. */
export async function respondToRecurringScopeChangeAction(_prevState: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const session = await requireCustomer();
  const repo = createSupabaseSchedulingRepository();

  const recurringScopeVersionId = String(formData.get("recurringScopeVersionId") ?? "");
  const decision = String(formData.get("decision") ?? "");
  if (!recurringScopeVersionId || (decision !== "approve" && decision !== "reject")) {
    return actionError("Choose approve or decline.");
  }

  try {
    await assertRecurringScopeVersionBelongsToCustomer(repo, recurringScopeVersionId, session.customerId);
    if (decision === "approve") {
      await approveRecurringScopeChange(repo, recurringScopeVersionId);
    } else {
      await rejectRecurringScopeChange(repo, recurringScopeVersionId);
    }
    revalidatePath("/my");
    return actionOk(decision === "approve" ? "Approved." : "Declined.");
  } catch (error) {
    if (error instanceof CustomerOwnershipError || error instanceof InvalidVisitStateError) {
      return actionError(error.message);
    }
    throw error;
  }
}

/** Customer approves a per-visit price increase (a materially higher amount than what was previously approved) — clears the gate so admin can then confirm it as final. */
export async function approveVisitPricingIncreaseAction(_prevState: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const session = await requireCustomer();
  const repo = createSupabaseSchedulingRepository();

  const serviceVisitId = String(formData.get("serviceVisitId") ?? "");
  if (!serviceVisitId) {
    return actionError("Missing visit id.");
  }

  try {
    await assertVisitBelongsToCustomer(repo, serviceVisitId, session.customerId);
    await approveVisitPricingIncrease(repo, serviceVisitId);
    revalidatePath("/my/cleanings");
    return actionOk("Approved — we'll confirm the final price shortly.");
  } catch (error) {
    if (error instanceof CustomerOwnershipError || error instanceof InvalidVisitStateError) {
      return actionError(error.message);
    }
    throw error;
  }
}
