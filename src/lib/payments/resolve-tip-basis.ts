import type { ServiceVisitPricingRow, ServiceVisitRow } from "@/lib/scheduling/domain-types";
import type { SchedulingRepository } from "@/lib/scheduling/repository";
import { InvalidVisitStateError } from "@/lib/scheduling/errors";

/**
 * The pre-tax value tip percentages are computed against — server-
 * authoritative, never the raw amount_due_from_customer for a prepaid
 * visit (which is $0 for the package-covered base and would make every
 * percentage tip $0 too).
 *
 * Pay Per Cleaning: amount_due_from_customer as-is (already excludes tax,
 * any existing tip, and unrelated fees).
 *
 * Prepaid: prepaid_packages.effective_price_per_visit (the actual per-visit
 * price paid at package purchase — a historical fact, never re-derived from
 * the live pricing engine) + the visit's own approved add_on_amount. Never
 * the package base's own $0 amount_due_from_customer.
 */
export async function resolveTipBasisAmount(repo: SchedulingRepository, visit: ServiceVisitRow, pricing: ServiceVisitPricingRow): Promise<number> {
  if (!visit.prepaidPackageId) {
    return pricing.amountDueFromCustomer;
  }

  const prepaidPackage = await repo.findPrepaidPackageById(visit.prepaidPackageId);
  if (!prepaidPackage) {
    throw new InvalidVisitStateError(`prepaid_package ${visit.prepaidPackageId} not found while resolving tip basis for visit ${visit.id}`);
  }
  return prepaidPackage.effectivePricePerVisit + pricing.addOnAmount;
}
