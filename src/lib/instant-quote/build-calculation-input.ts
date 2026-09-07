import type { CalculationInput, PropertyKind } from "@/lib/pricing/types";
import { resolveSizeTier } from "./size-tier";
import type { InstantQuotePropertyType, ValidatedInstantQuoteInput } from "./types";

/**
 * home/apartment/airbnb pass straight through to the pricing engine's own
 * PropertyKind; restaurant/office collapse to "commercial", which
 * calculateEstimate already routes to manual review with zero automatic
 * pricing (see calculate-estimate.ts's COMMERCIAL_PROPERTY guard) — this
 * milestone introduces no new commercial pricing logic, only this mapping.
 */
export function mapPropertyTypeToPricingKind(propertyType: InstantQuotePropertyType): PropertyKind {
  switch (propertyType) {
    case "home":
    case "apartment":
    case "airbnb":
      return propertyType;
    case "restaurant":
    case "office":
      return "commercial";
  }
}

/**
 * Constructs the pricing engine's CalculationInput from validated raw
 * customer choices plus the two values the server alone is trusted to
 * supply: firstCleaningEligible (from checkFirstCleaningEligibility, never
 * a client claim) and asOf (the server's own clock, for determinism).
 */
export function buildCalculationInput(
  validated: ValidatedInstantQuoteInput,
  firstCleaningEligible: boolean,
  asOf: Date
): CalculationInput {
  return {
    propertyKind: mapPropertyTypeToPricingKind(validated.propertyType),
    cleaningType: validated.cleaningType,
    condition: validated.condition,
    sizeTier: resolveSizeTier(validated.rooms.bedrooms),
    rooms: validated.rooms,
    squareFeet: validated.squareFeet ?? undefined,
    zip: validated.serviceAddress.zip,
    frequency: validated.frequency,
    isPrepaidPackage: validated.isPrepaidPackage,
    visitCount: validated.visitCount,
    addOnIds: validated.addOnIds,
    visitAddOns: validated.visitAddOns ?? undefined,
    specialRooms: validated.specialRooms.length > 0 ? validated.specialRooms : undefined,
    movePackageLevel: validated.movePackageLevel ?? undefined,
    moveDirection: validated.moveDirection ?? undefined,
    outdoorSelection: validated.outdoorSelection ?? undefined,
    quantifiedAddOns: validated.quantifiedAddOns.length > 0 ? validated.quantifiedAddOns : undefined,
    firstCleaningEligible,
    asOf,
  };
}
