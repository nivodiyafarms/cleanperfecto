import type { BookingRepository } from "@/lib/booking/repository";
import type { CustomPricingAdjustmentType, ServiceVisitPricingRow } from "./domain-types";
import { estimateVisitPricing } from "./estimate-visit-pricing";
import { InvalidVisitStateError } from "./errors";
import type { SchedulingRepository } from "./repository";

export interface AddCustomPricingAdjustmentInput {
  serviceVisitId: string;
  type: CustomPricingAdjustmentType;
  description: string;
  amount: number;
  actorAdminUserId: string;
  actorRole: string;
}

/**
 * Admin "Custom Charge" / "Custom Discount / Credit" — reuses the exact
 * same Final Scope architecture as the predefined add-ons (updateFinalScopeAction
 * -> estimateVisitPricing), never a second pricing system. Only usable
 * during the same work-finished window the predefined add-on checklist is
 * — same rule, same reason (see estimate-visit-pricing.ts's own completed-
 * visit guard).
 *
 * RBAC is the CALLER's responsibility (assertCapability("complete_service_visit")
 * for a charge, assertCapability("financial_correction") for a discount/
 * credit — owner-only, a financial correction), same layering as every
 * other admin domain function in this codebase.
 *
 * Sequence:
 *   1. Ensure a service_visit_pricing row exists at all (estimateVisitPricing
 *      is a safe, idempotent upsert even with zero add-ons — a Final Scope
 *      that never touched the add-on checklist yet has no row otherwise).
 *   2. addCustomPricingAdjustmentWithAudit — atomically appends the
 *      adjustment AND writes the required financial_audit_log row (either
 *      both commit or neither does).
 *   3. estimateVisitPricing again — the ONLY place total_amount/
 *      amount_due_from_customer/requires_customer_approval are actually
 *      recomputed, reusing the exact existing approved-vs-final comparison
 *      (never a simplistic "any custom charge needs approval" rule).
 */
export async function addCustomPricingAdjustment(
  repo: SchedulingRepository,
  bookingRepo: BookingRepository,
  input: AddCustomPricingAdjustmentInput
): Promise<ServiceVisitPricingRow> {
  const visit = await repo.findServiceVisitById(input.serviceVisitId);
  if (!visit) {
    throw new InvalidVisitStateError(`service_visit ${input.serviceVisitId} not found`);
  }
  if (visit.status !== "work_finished") {
    throw new InvalidVisitStateError(
      `service_visit ${input.serviceVisitId} must be work-finished before a custom charge/discount can be added (current status: ${visit.status})`
    );
  }
  if (!input.description.trim()) {
    throw new InvalidVisitStateError("A reason/description is required for a custom charge or discount/credit.");
  }
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    throw new InvalidVisitStateError("The amount must be a positive number.");
  }

  const existingPricing = await repo.findServiceVisitPricingByVisitId(input.serviceVisitId);
  const pricingBeforeAdjustment = await estimateVisitPricing(
    repo,
    { serviceVisitId: input.serviceVisitId, addOnIds: existingPricing?.addOnIds ?? [] },
    bookingRepo
  );

  await repo.addCustomPricingAdjustmentWithAudit(
    pricingBeforeAdjustment.id,
    { type: input.type, description: input.description.trim(), amount: input.amount },
    { actorAdminUserId: input.actorAdminUserId, actorRole: input.actorRole }
  );

  return estimateVisitPricing(repo, { serviceVisitId: input.serviceVisitId, addOnIds: pricingBeforeAdjustment.addOnIds }, bookingRepo);
}
