import type { AddOnId, ManualQuoteAddOnResult, PricedAddOnResult } from "./types";

export type AddOnPricingKind = "fixed" | "starting_at" | "manual_quote";

export interface AddOnDefinition {
  id: AddOnId;
  label: string;
  kind: AddOnPricingKind;
  /** Dollar contribution used in calculation. Present only for fixed/starting_at — manual_quote add-ons never receive an invented amount. */
  amount?: number;
}

/** Approved add-on catalog — owner message 2026-08-12 ("ADD-ON UPDATE"). */
export const ADD_ON_CATALOG: Record<AddOnId, AddOnDefinition> = {
  inside_oven: { id: "inside_oven", label: "Inside Oven", kind: "fixed", amount: 35 },
  inside_refrigerator: {
    id: "inside_refrigerator",
    label: "Inside Refrigerator",
    kind: "fixed",
    amount: 35,
  },
  inside_cabinets_drawers: {
    id: "inside_cabinets_drawers",
    label: "Inside Cabinets & Drawers",
    kind: "starting_at",
    amount: 40,
  },
  extra_pet_hair_removal: {
    id: "extra_pet_hair_removal",
    label: "Extra Pet Hair Removal",
    kind: "starting_at",
    amount: 20,
  },
  carpet_shampooing: {
    id: "carpet_shampooing",
    label: "Carpet Shampooing",
    kind: "manual_quote",
  },
  heavy_organization: {
    id: "heavy_organization",
    label: "Heavy Organization",
    kind: "manual_quote",
  },
  additional_interior_window_detailing: {
    id: "additional_interior_window_detailing",
    label: "Additional Interior Window Detailing",
    kind: "manual_quote",
  },
  boxing_packing: {
    id: "boxing_packing",
    label: "Boxing & Packing",
    kind: "manual_quote",
  },
};

export interface AddOnClassification {
  priced: PricedAddOnResult[];
  pricedTotal: number;
  manual: ManualQuoteAddOnResult[];
}

/** Deduplicates repeated ids so a double-submitted add-on can't double-charge. */
export function classifyAddOns(addOnIds: AddOnId[]): AddOnClassification {
  const priced: PricedAddOnResult[] = [];
  const manual: ManualQuoteAddOnResult[] = [];

  for (const id of new Set(addOnIds)) {
    const definition = ADD_ON_CATALOG[id];
    if (definition.kind === "manual_quote") {
      manual.push({ id: definition.id, label: definition.label });
    } else {
      priced.push({
        id: definition.id,
        label: definition.label,
        amount: definition.amount as number,
        pricingKind: definition.kind,
      });
    }
  }

  const pricedTotal = priced.reduce((sum, addOn) => sum + addOn.amount, 0);
  return { priced, pricedTotal, manual };
}
