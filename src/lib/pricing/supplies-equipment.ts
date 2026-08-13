import type { CleaningType, SizeTier } from "./types";

export interface SuppliesEquipmentRule {
  cleaningType: CleaningType;
  sizeTier: SizeTier;
  amount: number;
}

export type SuppliesEquipmentLookupResult =
  | { configured: true; amount: number }
  | { configured: false; reason: "SUPPLIES_EQUIPMENT_NOT_CONFIGURED" };

/**
 * Production supplies/equipment table — intentionally empty until real
 * service-type × size-tier amounts are approved (owner message 2026-08-12,
 * item 3). Do not fall back to a single flat fee such as $22.50; tests must
 * inject their own fixtures via the `config` parameter, never this array.
 */
export const SUPPLIES_EQUIPMENT_CONFIG: SuppliesEquipmentRule[] = [];

export function getSuppliesEquipmentCharge(
  cleaningType: CleaningType,
  sizeTier: SizeTier,
  config: SuppliesEquipmentRule[] = SUPPLIES_EQUIPMENT_CONFIG
): SuppliesEquipmentLookupResult {
  const match = config.find(
    (rule) => rule.cleaningType === cleaningType && rule.sizeTier === sizeTier
  );
  if (!match) {
    return { configured: false, reason: "SUPPLIES_EQUIPMENT_NOT_CONFIGURED" };
  }
  return { configured: true, amount: match.amount };
}
