import { PRICING_VERSION } from "@/lib/pricing/config";
import { roundToCents } from "@/lib/pricing/money";
import type { AddOnId } from "@/lib/pricing/types";
import { enqueueNotification } from "@/lib/notifications/enqueue-notification";
import type { ServiceVisitPricingRow } from "./domain-types";
import { InvalidVisitStateError } from "./errors";
import type { SchedulingRepository } from "./repository";
import { classifyAddOns } from "@/lib/pricing/add-ons";

export interface EstimateVisitPricingInput {
  serviceVisitId: string;
  /** Only priced (fixed/starting_at) add-on ids — a caller with manual-quote selections should exclude them here (see request-visit-add-ons.ts, which classifies before calling this). */
  addOnIds: AddOnId[];
}

/**
 * Computes (and persists) the current price estimate for a service_visit
 * generated under a recurring_schedule — the second-and-later visit of a
 * recurring relationship, package or Pay Per Cleaning alike. The one
 * directly-booked first visit of a relationship is priced by
 * booking_orders already and never touches this table.
 *
 * base_amount is NOT recomputed here via calculateEstimate() per visit —
 * the recurring relationship's base scope/price is already server-
 * authoritative and frozen on its active recurring_scope_versions row (see
 * propose-recurring-scope-change.ts, which IS where calculateEstimate()
 * runs). This function only adds each visit's OWN add-on selection on top,
 * via the same add-on catalog (classifyAddOns) every other pricing path
 * uses — never a second, duplicated add-on price list.
 *
 * For a package-linked visit (service_visits.prepaid_package_id is not
 * null), base_amount is 0 (covered by the package) and
 * amount_due_from_customer is add-ons only; for a Pay Per Cleaning visit,
 * amount_due_from_customer is the full total.
 *
 * requires_customer_approval is set only when the newly computed
 * total_amount EXCEEDS the last customer-approved amount for this specific
 * visit — a same-or-lower re-estimate never blocks.
 */
export async function estimateVisitPricing(
  repo: SchedulingRepository,
  input: EstimateVisitPricingInput
): Promise<ServiceVisitPricingRow> {
  const visit = await repo.findServiceVisitById(input.serviceVisitId);
  if (!visit) {
    throw new InvalidVisitStateError(`service_visit ${input.serviceVisitId} not found`);
  }
  if (!visit.recurringScheduleId) {
    throw new InvalidVisitStateError(
      `service_visit ${input.serviceVisitId} has no recurring_schedule_id — the one directly-booked first visit is priced via booking_orders, not service_visit_pricing`
    );
  }

  const isPackageVisit = visit.prepaidPackageId !== null;

  let baseAmount = 0;
  if (!isPackageVisit) {
    const scopeVersion = await repo.findActiveRecurringScopeVersion(visit.recurringScheduleId);
    if (!scopeVersion || scopeVersion.approvedBaseAmount === null) {
      throw new InvalidVisitStateError(
        `recurring_schedule ${visit.recurringScheduleId} has no approved base scope/amount yet — propose and approve one (see propose-recurring-scope-change.ts) before estimating a Pay Per Cleaning visit's price`
      );
    }
    baseAmount = scopeVersion.approvedBaseAmount;
  }

  const classified = classifyAddOns(input.addOnIds);
  const addOnAmount = roundToCents(classified.pricedTotal);
  const totalAmount = roundToCents(baseAmount + addOnAmount);
  const amountDueFromCustomer = isPackageVisit ? addOnAmount : totalAmount;

  const existing = await repo.findServiceVisitPricingByVisitId(input.serviceVisitId);
  const previouslyApprovedAmount = existing?.previouslyApprovedAmount ?? null;
  const requiresCustomerApproval = previouslyApprovedAmount !== null && totalAmount > previouslyApprovedAmount;

  // Only a genuine INCREASE over the last customer-approved amount ever
  // needs a notice — a same-or-lower re-estimate proceeds automatically
  // under the existing business rule and must never notify. versionKey is
  // the new total itself, so re-estimating to the SAME over-threshold
  // amount again (e.g. an idempotent retry) never duplicates the notice,
  // while a DIFFERENT (higher) amount correctly mints a fresh one.
  if (requiresCustomerApproval) {
    await enqueueNotification(repo, {
      serviceVisitId: input.serviceVisitId,
      customerId: visit.customerId,
      notificationType: "pricing_approval_required",
      channel: "email",
      scheduledSendAt: new Date(),
      versionKey: totalAmount.toFixed(2),
    });
  }

  return repo.upsertServiceVisitPricing({
    serviceVisitId: input.serviceVisitId,
    pricingVersion: PRICING_VERSION,
    pricingSnapshot: { addOnIds: input.addOnIds, priced: classified.priced, baseAmount },
    baseAmount,
    addOnIds: classified.priced.map((p) => p.id),
    addOnAmount,
    totalAmount,
    amountDueFromCustomer,
    priceStatus: requiresCustomerApproval ? "pending_customer_approval" : "estimated",
    requiresCustomerApproval,
    previouslyApprovedAmount,
  });
}
