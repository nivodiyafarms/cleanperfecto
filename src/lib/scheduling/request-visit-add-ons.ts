import { classifyAddOns } from "@/lib/pricing/add-ons";
import type { AddOnId } from "@/lib/pricing/types";
import type { ServiceVisitPricingRow } from "./domain-types";
import { estimateVisitPricing } from "./estimate-visit-pricing";
import { InvalidVisitStateError } from "./errors";
import type { SchedulingRepository } from "./repository";

export interface RequestVisitAddOnsInput {
  serviceVisitId: string;
  /** The customer's full desired selection for THIS visit only — replaces, never merges with, whatever was selected before (matches "one visit only by default," never multiplied across other visits). */
  addOnIds: AddOnId[];
}

export interface RequestVisitAddOnsResult {
  pricing: ServiceVisitPricingRow;
  /** Add-ons the customer selected that are manual-quote only (e.g. Boxing & Packing) — excluded from pricing.addOnIds/addOnAmount entirely; never auto-priced. Surface these separately as "we'll follow up with a quote." */
  manualQuoteAddOnIds: AddOnId[];
}

/**
 * Customer requests extras for one specific, still-eligible (not
 * completed/cancelled) future cleaning — server-authoritative pricing via
 * the existing add-on catalog (src/lib/pricing/add-ons.ts), never a second
 * price list and never free-text pricing. Manual-quote add-ons are split
 * out and never folded into the priced total, preserving the existing rule
 * that a manual-quote add-on stays manual-quote everywhere in this system.
 */
export async function requestVisitAddOns(
  repo: SchedulingRepository,
  input: RequestVisitAddOnsInput
): Promise<RequestVisitAddOnsResult> {
  const visit = await repo.findServiceVisitById(input.serviceVisitId);
  if (!visit) {
    throw new InvalidVisitStateError(`service_visit ${input.serviceVisitId} not found`);
  }
  if (visit.status === "completed" || visit.status === "cancelled") {
    throw new InvalidVisitStateError(
      `service_visit ${input.serviceVisitId} is ${visit.status} — add-ons can only be requested for an upcoming visit`
    );
  }

  const classified = classifyAddOns(input.addOnIds);
  const pricedIds = classified.priced.map((p) => p.id);

  const pricing = await estimateVisitPricing(repo, { serviceVisitId: input.serviceVisitId, addOnIds: pricedIds });

  return { pricing, manualQuoteAddOnIds: classified.manual.map((m) => m.id) };
}
