import type { BookingRepository } from "@/lib/booking/repository";
import type { ServiceVisitPricingRow } from "./domain-types";
import { estimateVisitPricing } from "./estimate-visit-pricing";
import { InvalidVisitStateError } from "./errors";
import type { SchedulingRepository } from "./repository";

export interface RemoveCustomPricingAdjustmentInput {
  serviceVisitId: string;
  adjustmentId: string;
  actorAdminUserId: string;
  actorRole: string;
}

/**
 * The remove side of add-custom-pricing-adjustment.ts — see that file's
 * doc comment for the shared architecture/RBAC rationale. Removing a
 * discount/credit is authorized the same way adding one is
 * (assertCapability("financial_correction"), owner-only) — the CALLER's
 * responsibility, not enforced here.
 */
export async function removeCustomPricingAdjustment(
  repo: SchedulingRepository,
  bookingRepo: BookingRepository,
  input: RemoveCustomPricingAdjustmentInput
): Promise<ServiceVisitPricingRow> {
  const visit = await repo.findServiceVisitById(input.serviceVisitId);
  if (!visit) {
    throw new InvalidVisitStateError(`service_visit ${input.serviceVisitId} not found`);
  }
  if (visit.status !== "work_finished") {
    throw new InvalidVisitStateError(
      `service_visit ${input.serviceVisitId} must be work-finished before a custom charge/discount can be removed (current status: ${visit.status})`
    );
  }

  const existingPricing = await repo.findServiceVisitPricingByVisitId(input.serviceVisitId);
  if (!existingPricing) {
    throw new InvalidVisitStateError(`service_visit ${input.serviceVisitId} has no pricing record yet — nothing to remove`);
  }

  await repo.removeCustomPricingAdjustmentWithAudit(existingPricing.id, input.adjustmentId, {
    actorAdminUserId: input.actorAdminUserId,
    actorRole: input.actorRole,
  });

  return estimateVisitPricing(repo, { serviceVisitId: input.serviceVisitId, addOnIds: existingPricing.addOnIds }, bookingRepo);
}
