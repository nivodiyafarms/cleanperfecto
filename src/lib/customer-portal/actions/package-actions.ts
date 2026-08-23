"use server";

import { revalidatePath } from "next/cache";
import { actionError, actionOk, type ActionResult } from "@/lib/admin/actions/types";
import { resolvePackageSchedulingContext } from "@/lib/admin/queries/visit-scope";
import { createPackageAmendment } from "@/lib/scheduling/create-package-amendment";
import { InvalidVisitStateError } from "@/lib/scheduling/errors";
import { createSupabaseSchedulingRepository } from "@/lib/scheduling/supabase-scheduling-repository";
import type { RecurringCadence } from "@/lib/scheduling/types";
import { assertPackageAmendmentBelongsToCustomer, assertPrepaidPackageBelongsToCustomer, CustomerOwnershipError } from "@/lib/customer-portal/ownership";
import { requireCustomer } from "@/lib/customer-portal/require-customer";

const CADENCES: RecurringCadence[] = ["weekly", "biweekly", "every_4_weeks"];

function isValidCadence(value: string): value is RecurringCadence {
  return (CADENCES as string[]).includes(value);
}

/**
 * Customer requests a cadence change for their prepaid package's remaining
 * visits — reuses the existing, unchanged createPackageAmendment (server-
 * authoritative repricing against the package's own originating booking
 * scope, resolved via resolvePackageSchedulingContext, never re-collected
 * or guessed). Creates the amendment in pending_customer_approval, exactly
 * as the admin-initiated path already does — the customer then approves or
 * declines via respondToPackageAmendmentAction below.
 */
export async function requestPackageCadenceChangeAction(_prevState: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const session = await requireCustomer();
  const repo = createSupabaseSchedulingRepository();

  const prepaidPackageId = String(formData.get("prepaidPackageId") ?? "");
  const newCadenceRaw = String(formData.get("newCadence") ?? "");
  const effectiveFromVisitNumber = Number(formData.get("effectiveFromVisitNumber") ?? "0");
  if (!prepaidPackageId || !isValidCadence(newCadenceRaw) || !effectiveFromVisitNumber) {
    return actionError("Missing required fields.");
  }

  try {
    await assertPrepaidPackageBelongsToCustomer(repo, prepaidPackageId, session.customerId);
    const context = await resolvePackageSchedulingContext(prepaidPackageId);
    if (!context) {
      return actionError("Could not resolve this package's original scope.");
    }

    const amendment = await createPackageAmendment(repo, {
      prepaidPackageId,
      newCadence: newCadenceRaw,
      effectiveFromVisitNumber,
      baseInput: context.calculationInput,
      now: new Date(),
      initiatedByNote: `customer:${session.customerAccountId}`,
    });

    revalidatePath("/my/package");
    return actionOk(
      amendment.valueDifference > 0
        ? `Requested — this changes your price by $${amendment.valueDifference.toFixed(2)}. Review and approve to continue.`
        : "Requested — review the updated pricing to approve."
    );
  } catch (error) {
    if (error instanceof CustomerOwnershipError || error instanceof InvalidVisitStateError) {
      return actionError(error.message);
    }
    throw error;
  }
}

/**
 * Customer approves or declines their own pending package amendment.
 * Mirrors admin's recordAmendmentApprovalAction exactly in scope: records
 * approval_state only. Actually APPLYING an approved amendment to real
 * planned dates (choosing the new first date/time) remains a separate,
 * admin-confirmed step via the existing Admin Dashboard — no automatic
 * scheduling decision is made here.
 */
export async function respondToPackageAmendmentAction(_prevState: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const session = await requireCustomer();
  const repo = createSupabaseSchedulingRepository();

  const packageAmendmentId = String(formData.get("packageAmendmentId") ?? "");
  const decision = String(formData.get("decision") ?? "");
  if (!packageAmendmentId || (decision !== "approve" && decision !== "reject")) {
    return actionError("Choose approve or decline.");
  }

  try {
    const amendment = await assertPackageAmendmentBelongsToCustomer(repo, packageAmendmentId, session.customerId);
    if (amendment.approvalState !== "pending_customer_approval") {
      return actionError("This request has already been decided.");
    }

    await repo.updatePackageAmendmentState(packageAmendmentId, {
      approvalState: decision === "approve" ? "approved" : "rejected",
    });

    revalidatePath("/my/package");
    return actionOk(
      decision === "approve"
        ? amendment.valueDifference > 0
          ? "Approved — we'll follow up to collect the additional balance before this takes effect."
          : "Approved — we'll confirm the updated schedule shortly."
        : "Declined."
    );
  } catch (error) {
    if (error instanceof CustomerOwnershipError || error instanceof InvalidVisitStateError) {
      return actionError(error.message);
    }
    throw error;
  }
}
