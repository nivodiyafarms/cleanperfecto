import type {
  AddOnId,
  ManualQuoteAddOnResult,
  PricedAddOnResult,
  QuantifiedAddOnId,
  QuantifiedAddOnResult,
  QuantifiedAddOnSelection,
} from "./types";

export type AddOnPricingKind = "fixed" | "starting_at" | "manual_quote";

export interface AddOnDefinition {
  id: AddOnId;
  label: string;
  kind: AddOnPricingKind;
  /** Dollar contribution used in calculation. Present only for fixed/starting_at — manual_quote add-ons never receive an invented amount. */
  amount?: number;
}

/**
 * Indoor add-ons requiring/replacing one another so the server never
 * double-charges even if a manipulated request submits overlapping ids —
 * see stripOverlappingIndoorAddOns below.
 */
export const REFRIGERATOR_OVEN_BUNDLE_COMPONENTS: AddOnId[] = ["inside_refrigerator", "inside_oven"];

/** The three interior add-ons a Complete Move-In/Move-Out package folds in — never separately chargeable once Complete is selected. See calculate-estimate.ts's Complete-package handling. */
export const COMPLETE_MOVE_PACKAGE_ADD_ONS: AddOnId[] = [
  "inside_refrigerator",
  "inside_oven",
  "refrigerator_oven_bundle",
  "inside_cabinets_drawers",
];

/** Approved add-on catalog — owner message 2026-08-12 ("ADD-ON UPDATE"), Oven Interior/Bundle updated by the 2026-08-30 pricing hotfix. */
export const ADD_ON_CATALOG: Record<AddOnId, AddOnDefinition> = {
  inside_oven: { id: "inside_oven", label: "Oven Interior", kind: "fixed", amount: 30 },
  inside_refrigerator: {
    id: "inside_refrigerator",
    label: "Refrigerator Interior",
    kind: "fixed",
    amount: 35,
  },
  refrigerator_oven_bundle: {
    id: "refrigerator_oven_bundle",
    label: "Refrigerator + Oven Bundle",
    kind: "fixed",
    amount: 55,
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

/**
 * When the Refrigerator + Oven Bundle is selected alongside either (or both)
 * of its standalone components, the bundle wins and the standalone
 * components are dropped — automatic optimization rather than rejecting the
 * request, so a manipulated submission of Bundle + Refrigerator + Oven still
 * charges exactly $55, never $55 + $35 + $30. Order-independent and applies
 * before classifyAddOns runs, for both a one-off request's addOnIds and each
 * visit's own selection in a prepaid package.
 */
export function resolveIndoorAddOnOverlap(addOnIds: AddOnId[]): AddOnId[] {
  const ids = new Set(addOnIds);
  if (ids.has("refrigerator_oven_bundle")) {
    for (const component of REFRIGERATOR_OVEN_BUNDLE_COMPONENTS) {
      ids.delete(component);
    }
  }
  return Array.from(ids);
}

export interface CompletePackageAddOnSplit {
  /** addOnIds with every Complete-package-included item removed. */
  remaining: AddOnId[];
  /** The Complete-package-included items that were present and stripped, deduplicated, in catalog order. */
  included: ManualQuoteAddOnResult[];
}

/**
 * A Complete Move-In/Move-Out package folds in Refrigerator/Oven/Cabinet
 * Interior automatically — they must never remain independently chargeable,
 * even if a manipulated request submits Complete + all three standalone
 * add-ons. Enforced here server-side, not merely by disabling UI checkboxes.
 */
export function splitCompletePackageAddOns(addOnIds: AddOnId[]): CompletePackageAddOnSplit {
  const includedSet = new Set(COMPLETE_MOVE_PACKAGE_ADD_ONS);
  const remaining: AddOnId[] = [];
  const included: ManualQuoteAddOnResult[] = [];

  for (const id of new Set(addOnIds)) {
    if (includedSet.has(id)) {
      included.push({ id, label: ADD_ON_CATALOG[id].label });
    } else {
      remaining.push(id);
    }
  }

  return { remaining, included };
}

/** Deduplicates repeated ids so a double-submitted add-on can't double-charge. */
export function classifyAddOns(addOnIds: AddOnId[]): AddOnClassification {
  const priced: PricedAddOnResult[] = [];
  const manual: ManualQuoteAddOnResult[] = [];

  for (const id of new Set(resolveIndoorAddOnOverlap(addOnIds))) {
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

// ---------------------------------------------------------------------------
// Quantified add-ons — priced per unit rather than as a flat presence/
// absence charge (owner-approved hotfix, 2026-08-30). Kept as a parallel
// mechanism to ADD_ON_CATALOG/classifyAddOns rather than forcing a quantity
// into the boolean AddOnId model.
// ---------------------------------------------------------------------------

export interface QuantifiedAddOnDefinition {
  id: QuantifiedAddOnId;
  label: string;
  perUnitAmount: number;
}

export const QUANTIFIED_ADD_ON_CATALOG: Record<QuantifiedAddOnId, QuantifiedAddOnDefinition> = {
  interior_window_detailing: {
    id: "interior_window_detailing",
    label: "Interior Window Detailing",
    perUnitAmount: 10,
  },
  exterior_window_cleaning: {
    id: "exterior_window_cleaning",
    label: "Exterior Window Cleaning",
    perUnitAmount: 10,
  },
};

/** Ground-level / safely reachable windows only — approved customer wording for exterior window cleaning. */
export const EXTERIOR_WINDOW_CUSTOMER_NOTE = "Ground-level / safely reachable windows only.";

export interface QuantifiedAddOnClassification {
  priced: QuantifiedAddOnResult[];
  pricedTotal: number;
}

/**
 * Deduplicates by id (summing quantities) so the same add-on submitted twice
 * accumulates rather than silently overwriting. A non-positive or
 * non-integer quantity contributes nothing rather than an invented amount.
 */
export function classifyQuantifiedAddOns(
  selections: QuantifiedAddOnSelection[] | undefined
): QuantifiedAddOnClassification {
  if (!selections || selections.length === 0) {
    return { priced: [], pricedTotal: 0 };
  }

  const quantitiesById = new Map<QuantifiedAddOnId, number>();
  for (const selection of selections) {
    if (!Number.isInteger(selection.quantity) || selection.quantity <= 0) {
      continue;
    }
    quantitiesById.set(selection.id, (quantitiesById.get(selection.id) ?? 0) + selection.quantity);
  }

  const priced: QuantifiedAddOnResult[] = [];
  for (const [id, quantity] of quantitiesById) {
    const definition = QUANTIFIED_ADD_ON_CATALOG[id];
    priced.push({ id, label: definition.label, quantity, amount: quantity * definition.perUnitAmount });
  }

  const pricedTotal = priced.reduce((sum, item) => sum + item.amount, 0);
  return { priced, pricedTotal };
}
