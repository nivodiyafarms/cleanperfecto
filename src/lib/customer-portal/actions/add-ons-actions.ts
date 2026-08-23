"use server";

import { revalidatePath } from "next/cache";
import { actionError, actionOk, type ActionResult } from "@/lib/admin/actions/types";
import type { AddOnId } from "@/lib/pricing/types";
import { InvalidVisitStateError } from "@/lib/scheduling/errors";
import { requestVisitAddOns } from "@/lib/scheduling/request-visit-add-ons";
import { createSupabaseSchedulingRepository } from "@/lib/scheduling/supabase-scheduling-repository";
import { requireCustomer } from "@/lib/customer-portal/require-customer";
import { assertVisitBelongsToCustomer, CustomerOwnershipError } from "@/lib/customer-portal/ownership";

/**
 * Customer adds extras to ONE eligible upcoming visit only — server-
 * authoritative pricing via the existing add-on catalog, never a second
 * price list. Manual-quote add-ons never become auto-priced; they're
 * surfaced back to the caller as "needs a manual quote" instead.
 */
export async function requestVisitAddOnsAction(_prevState: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const session = await requireCustomer();
  const repo = createSupabaseSchedulingRepository();

  const serviceVisitId = String(formData.get("serviceVisitId") ?? "");
  const addOnIds = formData.getAll("addOnIds").map(String) as AddOnId[];
  if (!serviceVisitId) {
    return actionError("Missing visit id.");
  }

  try {
    await assertVisitBelongsToCustomer(repo, serviceVisitId, session.customerId);
    const result = await requestVisitAddOns(repo, { serviceVisitId, addOnIds });

    revalidatePath("/my");
    revalidatePath("/my/cleanings");

    if (result.manualQuoteAddOnIds.length > 0) {
      return actionOk(
        `Updated — $${result.pricing.addOnAmount.toFixed(2)} in extras added. ${result.manualQuoteAddOnIds.length} selection(s) need a manual quote and will be followed up on separately.`
      );
    }
    return actionOk(`Updated — $${result.pricing.addOnAmount.toFixed(2)} in extras added.`);
  } catch (error) {
    if (error instanceof CustomerOwnershipError || error instanceof InvalidVisitStateError) {
      return actionError(error.message);
    }
    throw error;
  }
}
