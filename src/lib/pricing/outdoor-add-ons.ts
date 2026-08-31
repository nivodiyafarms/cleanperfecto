import type {
  AlgaeMildewTreatmentSize,
  ManualReviewReasonCode,
  OutdoorChargeResult,
  OutdoorManualChargeResult,
  OutdoorSelection,
  PatioSize,
  PorchSize,
  TrioSize,
} from "./types";

/**
 * Outdoor add-ons — porch/patio/garage, Trio bundles, and condition
 * treatments (owner-approved hotfix, 2026-08-30). An entirely separate
 * pricing category from indoor add-ons/room adjustments: never multiplied by
 * square-footage/condition, never discounted, added as flat per-visit
 * charges (same treatment as travel/supplies/priced add-ons).
 *
 * Regular Porch/Patio/Garage cleaning covers BASIC work only — sweeping/
 * loose-debris removal, accessible cobweb removal, floor-edge/corner
 * detailing, loose dirt/dust removal, basic surface wash, light scrubbing,
 * accessible surface wiping, basic garage floor cleaning. It does NOT
 * include restoration-level work, severe algae/mildew treatment, heavy oil
 * treatment, junk removal, major organization, paint removal, or rust
 * removal — those are the separate condition treatments below.
 */
export const OUTDOOR_STANDARD_SCOPE_NOTE =
  "Regular Porch/Patio/Garage cleaning covers basic upkeep — sweeping, accessible cobweb removal, surface wiping, and light scrubbing. Restoration-level work, heavy buildup treatment, and junk removal are separate.";

export const ALGAE_MILDEW_CUSTOMER_NOTE =
  "Deep treatment for visible black algae/mildew buildup. Results depend on surface condition and material.";

export interface SizeBand<TSize extends string> {
  size: TSize;
  maxSqFt: number;
  amount: number;
}

export const PORCH_CONFIG: SizeBand<PorchSize>[] = [
  { size: "small", maxSqFt: 80, amount: 30 },
  { size: "medium", maxSqFt: 150, amount: 45 },
  { size: "large", maxSqFt: 250, amount: 60 },
];

export const PATIO_CONFIG: SizeBand<PatioSize>[] = [
  { size: "small", maxSqFt: 150, amount: 45 },
  { size: "medium", maxSqFt: 300, amount: 65 },
  { size: "large", maxSqFt: 500, amount: 90 },
];

export const GARAGE_CONFIG: { cars: number; amount: number }[] = [
  { cars: 1, amount: 45 },
  { cars: 2, amount: 65 },
  { cars: 3, amount: 85 },
];

export const TRIO_CONFIG: Record<TrioSize, { amount: number; garageCars: number; porchMaxSqFt: number; patioMaxSqFt: number }> = {
  small: { amount: 99, garageCars: 1, porchMaxSqFt: 80, patioMaxSqFt: 150 },
  medium: { amount: 149, garageCars: 2, porchMaxSqFt: 150, patioMaxSqFt: 300 },
  large: { amount: 199, garageCars: 3, porchMaxSqFt: 250, patioMaxSqFt: 500 },
};

export const OIL_DEGREASE_PER_BAY = 40;

export const ALGAE_MILDEW_CONFIG: Record<AlgaeMildewTreatmentSize, number> = {
  small: 50,
  medium: 75,
  large: 100,
};

function findBand<TSize extends string>(
  squareFeet: number,
  config: SizeBand<TSize>[]
): SizeBand<TSize> | undefined {
  return config.find((band) => squareFeet <= band.maxSqFt);
}

export interface OutdoorClassification {
  priced: OutdoorChargeResult[];
  pricedTotal: number;
  manual: OutdoorManualChargeResult[];
  reasons: ManualReviewReasonCode[];
}

function priceIndividualPorch(sqFt: number): { priced?: OutdoorChargeResult; manual?: OutdoorManualChargeResult; reason?: ManualReviewReasonCode } {
  const band = findBand(sqFt, PORCH_CONFIG);
  if (!band) {
    return { manual: { id: "porch", label: "Porch Cleaning" }, reason: "PORCH_BEYOND_CONFIGURED_LIMIT" };
  }
  return { priced: { id: "porch", label: "Porch Cleaning", amount: band.amount } };
}

function priceIndividualPatio(sqFt: number): { priced?: OutdoorChargeResult; manual?: OutdoorManualChargeResult; reason?: ManualReviewReasonCode } {
  const band = findBand(sqFt, PATIO_CONFIG);
  if (!band) {
    return { manual: { id: "patio", label: "Patio Cleaning" }, reason: "PATIO_BEYOND_CONFIGURED_LIMIT" };
  }
  return { priced: { id: "patio", label: "Patio Cleaning", amount: band.amount } };
}

function priceIndividualGarage(cars: number): { priced?: OutdoorChargeResult; manual?: OutdoorManualChargeResult; reason?: ManualReviewReasonCode } {
  const match = GARAGE_CONFIG.find((entry) => entry.cars === cars);
  if (!match) {
    return { manual: { id: "garage", label: "Garage Cleaning" }, reason: "GARAGE_BEYOND_CONFIGURED_LIMIT" };
  }
  return { priced: { id: "garage", label: `Garage Cleaning (${cars}-Car)`, amount: match.amount } };
}

/**
 * Resolves the known garage capacity (in cars) for validating heavy oil/
 * degrease affected bays — from an explicit garageCars selection, or from a
 * successfully-applied Trio's included garage size. Undefined when the
 * garage size genuinely isn't known (oil-degrease pricing then proceeds
 * without a capacity check, per "when garage size is known").
 */
function resolveKnownGarageCapacity(input: OutdoorSelection, trioApplied: boolean): number | undefined {
  if (trioApplied && input.trio) {
    return TRIO_CONFIG[input.trio].garageCars;
  }
  return input.garageCars;
}

/**
 * Trio is an EXPLICIT customer selection — never auto-bundled from
 * individually-selected dimensions (section 12/13). When selected and every
 * provided dimension fits its capacity, the flat Trio price applies and its
 * components are never separately charged. When a provided dimension
 * exceeds capacity, the Trio itself is not applied — components fall back to
 * individual/custom pricing rather than silently truncating the customer's
 * dimensions to fit.
 */
export function classifyOutdoorSelection(input: OutdoorSelection | undefined): OutdoorClassification {
  const priced: OutdoorChargeResult[] = [];
  const manual: OutdoorManualChargeResult[] = [];
  const reasons: ManualReviewReasonCode[] = [];

  if (!input) {
    return { priced, pricedTotal: 0, manual, reasons };
  }

  let trioApplied = false;

  if (input.trio) {
    const capacity = TRIO_CONFIG[input.trio];
    const exceedsCapacity =
      (input.garageCars !== undefined && input.garageCars > capacity.garageCars) ||
      (input.porchSqFt !== undefined && input.porchSqFt > capacity.porchMaxSqFt) ||
      (input.patioSqFt !== undefined && input.patioSqFt > capacity.patioMaxSqFt);

    if (exceedsCapacity) {
      reasons.push("TRIO_CAPACITY_EXCEEDED");
      manual.push({
        id: "trio",
        label: `${capacity.amount === TRIO_CONFIG.small.amount ? "Small" : capacity.amount === TRIO_CONFIG.medium.amount ? "Medium" : "Large"} Trio Bundle (dimensions exceed selected size)`,
      });
      // Falls through to individual/custom pricing below — never silently truncated to fit.
    } else {
      trioApplied = true;
      const label = input.trio === "small" ? "Small Trio Bundle" : input.trio === "medium" ? "Medium Trio Bundle" : "Large Trio Bundle";
      priced.push({ id: "trio", label, amount: capacity.amount });
    }
  }

  if (!trioApplied) {
    if (input.porchSqFt !== undefined) {
      const result = priceIndividualPorch(input.porchSqFt);
      if (result.priced) priced.push(result.priced);
      if (result.manual) manual.push(result.manual);
      if (result.reason) reasons.push(result.reason);
    }
    if (input.patioSqFt !== undefined) {
      const result = priceIndividualPatio(input.patioSqFt);
      if (result.priced) priced.push(result.priced);
      if (result.manual) manual.push(result.manual);
      if (result.reason) reasons.push(result.reason);
    }
    if (input.garageCars !== undefined) {
      const result = priceIndividualGarage(input.garageCars);
      if (result.priced) priced.push(result.priced);
      if (result.manual) manual.push(result.manual);
      if (result.reason) reasons.push(result.reason);
    }
  }

  if (input.oilDegreaseAffectedBays !== undefined) {
    const knownCapacity = resolveKnownGarageCapacity(input, trioApplied);
    if (knownCapacity !== undefined && input.oilDegreaseAffectedBays > knownCapacity) {
      reasons.push("OIL_DEGREASE_BAYS_EXCEED_GARAGE_CAPACITY");
      manual.push({ id: "oil_degrease", label: "Heavy Garage Oil & Degrease (affected bays exceed garage capacity)" });
    } else {
      priced.push({
        id: "oil_degrease",
        label: `Heavy Garage Oil & Degrease (${input.oilDegreaseAffectedBays} bay${input.oilDegreaseAffectedBays === 1 ? "" : "s"})`,
        amount: input.oilDegreaseAffectedBays * OIL_DEGREASE_PER_BAY,
      });
    }
  }

  if (input.algaeMildewTreatmentSize) {
    const size = input.algaeMildewTreatmentSize;
    priced.push({
      id: "algae_mildew",
      label: `Black Algae & Mildew Deep Treatment (${size[0].toUpperCase()}${size.slice(1)})`,
      amount: ALGAE_MILDEW_CONFIG[size],
    });
  }

  const pricedTotal = priced.reduce((sum, item) => sum + item.amount, 0);
  return { priced, pricedTotal, manual, reasons };
}
