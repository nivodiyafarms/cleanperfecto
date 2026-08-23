import type { ServiceVisitPricingRow } from "./domain-types";
import { InvalidVisitStateError } from "./errors";
import type { SchedulingRepository } from "./repository";

export interface ConfirmVisitPricingInput {
  serviceVisitId: string;
  /** Free-text actor tag, e.g. "admin:<admin_user_id>" — same convention as package_amendments.initiated_by_note. */
  confirmedBy: string;
}

/**
 * Admin confirms the current estimate as a visit's final price —
 * price_status -> 'confirmed', previously_approved_amount -> total_amount,
 * payment_status -> 'awaiting_completion' if the customer owes anything
 * (else stays 'not_applicable'). Refuses to confirm an amount that still
 * requires customer approval (see approve-visit-pricing-increase.ts) —
 * never lets admin silently bypass that gate.
 */
export async function confirmVisitPricing(repo: SchedulingRepository, input: ConfirmVisitPricingInput): Promise<ServiceVisitPricingRow> {
  const existing = await repo.findServiceVisitPricingByVisitId(input.serviceVisitId);
  if (!existing) {
    throw new InvalidVisitStateError(
      `service_visit ${input.serviceVisitId} has no pricing estimate to confirm — call estimateVisitPricing first`
    );
  }
  if (existing.requiresCustomerApproval) {
    throw new InvalidVisitStateError(
      `service_visit ${input.serviceVisitId}'s pricing requires customer approval before it can be confirmed`
    );
  }

  const updated = await repo.confirmServiceVisitPricing(input.serviceVisitId, input.confirmedBy);
  if (!updated) {
    throw new InvalidVisitStateError(`service_visit_pricing for ${input.serviceVisitId} could not be confirmed`);
  }
  return updated;
}

/**
 * Customer approves a pricing increase (total_amount exceeded the
 * previously-approved amount) — clears the approval gate so admin can then
 * confirm it via confirmVisitPricing. A no-op (returns the row unchanged)
 * if nothing currently requires approval.
 */
export async function approveVisitPricingIncrease(repo: SchedulingRepository, serviceVisitId: string): Promise<ServiceVisitPricingRow> {
  const existing = await repo.findServiceVisitPricingByVisitId(serviceVisitId);
  if (!existing) {
    throw new InvalidVisitStateError(`service_visit ${serviceVisitId} has no pricing estimate to approve`);
  }
  if (!existing.requiresCustomerApproval) {
    return existing;
  }

  return repo.upsertServiceVisitPricing({
    serviceVisitId: existing.serviceVisitId,
    pricingVersion: existing.pricingVersion,
    pricingSnapshot: existing.pricingSnapshot,
    baseAmount: existing.baseAmount,
    addOnIds: existing.addOnIds,
    addOnAmount: existing.addOnAmount,
    totalAmount: existing.totalAmount,
    amountDueFromCustomer: existing.amountDueFromCustomer,
    priceStatus: "estimated",
    requiresCustomerApproval: false,
    previouslyApprovedAmount: existing.previouslyApprovedAmount,
  });
}
