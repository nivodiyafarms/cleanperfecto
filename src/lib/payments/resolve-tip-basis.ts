import type { ServiceVisitPricingRow, ServiceVisitRow } from "@/lib/scheduling/domain-types";
import type { SchedulingRepository } from "@/lib/scheduling/repository";
import { InvalidVisitStateError } from "@/lib/scheduling/errors";

/**
 * The pre-tax value tip percentages are computed against — server-
 * authoritative, never the raw amount_due_from_customer for a prepaid
 * visit (which is $0 for the package-covered base and would make every
 * percentage tip $0 too).
 *
 * A custom discount/credit is a CleanPerfecto financial concession to the
 * customer, not a reduction in the cleaner's performed work — it MUST NOT
 * erode the tip basis (or, symmetrically, the suggested tip). A custom
 * charge, by contrast, represents real extra chargeable work, so it's
 * added to the tip basis exactly like a predefined add-on already is. The
 * customer-facing/taxable amount (amount_due_from_customer/totalAmount)
 * still correctly nets the discount — only the tip basis excludes it.
 *
 * Pay Per Cleaning: base_amount + add_on_amount + custom_charge_amount —
 * deliberately NOT amount_due_from_customer, which nets custom_discount_amount.
 *
 * Prepaid: prepaid_packages.effective_price_per_visit (the actual per-visit
 * price paid at package purchase — a historical fact, never re-derived from
 * the live pricing engine) + the visit's own approved add_on_amount and
 * custom_charge_amount. Never the package base's own $0
 * amount_due_from_customer, and never custom_discount_amount.
 */
export async function resolveTipBasisAmount(repo: SchedulingRepository, visit: ServiceVisitRow, pricing: ServiceVisitPricingRow): Promise<number> {
  if (!visit.prepaidPackageId) {
    return pricing.baseAmount + pricing.addOnAmount + pricing.customChargeAmount;
  }

  const prepaidPackage = await repo.findPrepaidPackageById(visit.prepaidPackageId);
  if (!prepaidPackage) {
    throw new InvalidVisitStateError(`prepaid_package ${visit.prepaidPackageId} not found while resolving tip basis for visit ${visit.id}`);
  }
  return prepaidPackage.effectivePricePerVisit + pricing.addOnAmount + pricing.customChargeAmount;
}
