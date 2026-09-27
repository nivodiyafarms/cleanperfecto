import type { ServiceVisitPricingRow } from "./domain-types";
import { InvalidVisitStateError } from "./errors";
import type { SchedulingRepository } from "./repository";

export interface ConfirmVisitPricingInput {
  serviceVisitId: string;
  /** Free-text actor tag, e.g. "admin:<admin_user_id>" — same convention as package_amendments.initiated_by_note. */
  confirmedBy: string;
}

/**
 * Admin (or Finalize & Send, or the customer's own Final Total confirm)
 * confirms the current estimate as a visit's final price —
 * price_status -> 'confirmed', previously_approved_amount -> total_amount,
 * payment_status -> 'awaiting_completion' if the customer owes anything
 * (else stays 'not_applicable'). Pay Per Cleaning no longer has a separate
 * customer price-change approval gate (owner-approved product decision,
 * 2026-09-26 — see estimate-visit-pricing.ts's own doc comment): this always
 * confirms whatever the current estimate is, whether unchanged, lower, or
 * higher than any earlier estimate. The customer's own explicit Pay action
 * on their Final Total is the authorization point instead.
 */
export async function confirmVisitPricing(repo: SchedulingRepository, input: ConfirmVisitPricingInput): Promise<ServiceVisitPricingRow> {
  const existing = await repo.findServiceVisitPricingByVisitId(input.serviceVisitId);
  if (!existing) {
    throw new InvalidVisitStateError(
      `service_visit ${input.serviceVisitId} has no pricing estimate to confirm — call estimateVisitPricing first`
    );
  }

  const updated = await repo.confirmServiceVisitPricing(input.serviceVisitId, input.confirmedBy);
  if (!updated) {
    throw new InvalidVisitStateError(`service_visit_pricing for ${input.serviceVisitId} could not be confirmed`);
  }
  return updated;
}

/**
 * Legacy: clears requires_customer_approval if it happens to be set on an
 * older row (the flag is never set by estimateVisitPricing() anymore — see
 * its own doc comment — so this is a no-op for any freshly computed
 * estimate). Retained, unused by any current UI, purely so a pre-existing
 * row from before the 2026-09-26 product decision remains resolvable
 * without a migration.
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
