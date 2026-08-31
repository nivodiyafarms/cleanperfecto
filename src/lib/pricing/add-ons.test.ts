import { describe, expect, it } from "vitest";
import { classifyAddOns, classifyQuantifiedAddOns, splitCompletePackageAddOns } from "./add-ons";

describe("classifyAddOns", () => {
  it("prices Oven Interior at the approved fixed $30", () => {
    const { priced, pricedTotal, manual } = classifyAddOns(["inside_oven"]);
    expect(priced).toEqual([
      { id: "inside_oven", label: "Oven Interior", amount: 30, pricingKind: "fixed" },
    ]);
    expect(pricedTotal).toBe(30);
    expect(manual).toEqual([]);
  });

  it("prices Refrigerator Interior at the approved fixed $35", () => {
    const { priced, pricedTotal } = classifyAddOns(["inside_refrigerator"]);
    expect(priced).toEqual([
      { id: "inside_refrigerator", label: "Refrigerator Interior", amount: 35, pricingKind: "fixed" },
    ]);
    expect(pricedTotal).toBe(35);
  });

  it("prices the Refrigerator + Oven Bundle at the approved fixed $55", () => {
    const { priced, pricedTotal } = classifyAddOns(["refrigerator_oven_bundle"]);
    expect(priced).toEqual([
      { id: "refrigerator_oven_bundle", label: "Refrigerator + Oven Bundle", amount: 55, pricingKind: "fixed" },
    ]);
    expect(pricedTotal).toBe(55);
  });

  it("the bundle absorbs its standalone components rather than double-charging", () => {
    const { priced, pricedTotal } = classifyAddOns(["refrigerator_oven_bundle", "inside_oven", "inside_refrigerator"]);
    expect(priced).toEqual([
      { id: "refrigerator_oven_bundle", label: "Refrigerator + Oven Bundle", amount: 55, pricingKind: "fixed" },
    ]);
    expect(pricedTotal).toBe(55);
  });

  it("uses the approved starting-at amount for cabinets/drawers and pet hair without inventing a higher final figure", () => {
    const { priced, pricedTotal } = classifyAddOns(["inside_cabinets_drawers", "extra_pet_hair_removal"]);
    expect(priced).toEqual([
      { id: "inside_cabinets_drawers", label: "Inside Cabinets & Drawers", amount: 40, pricingKind: "starting_at" },
      { id: "extra_pet_hair_removal", label: "Extra Pet Hair Removal", amount: 20, pricingKind: "starting_at" },
    ]);
    expect(pricedTotal).toBe(60);
  });

  it("classifies Boxing & Packing as manual-quote with no invented amount", () => {
    const { manual, priced } = classifyAddOns(["boxing_packing"]);
    expect(manual).toEqual([{ id: "boxing_packing", label: "Boxing & Packing" }]);
    expect(priced).toEqual([]);
  });

  it("classifies all four manual-quote add-ons with no amount attached", () => {
    const { manual, pricedTotal } = classifyAddOns([
      "carpet_shampooing",
      "heavy_organization",
      "additional_interior_window_detailing",
      "boxing_packing",
    ]);
    expect(manual.map((addOn) => addOn.id).sort()).toEqual(
      [
        "additional_interior_window_detailing",
        "boxing_packing",
        "carpet_shampooing",
        "heavy_organization",
      ].sort()
    );
    expect(pricedTotal).toBe(0);
  });

  it("mixes priced and manual-quote add-ons in one request", () => {
    const { priced, manual, pricedTotal } = classifyAddOns(["inside_oven", "boxing_packing"]);
    expect(priced).toHaveLength(1);
    expect(manual).toEqual([{ id: "boxing_packing", label: "Boxing & Packing" }]);
    expect(pricedTotal).toBe(30);
  });

  it("deduplicates a repeated add-on id instead of double-charging", () => {
    const { priced, pricedTotal } = classifyAddOns(["inside_oven", "inside_oven"]);
    expect(priced).toHaveLength(1);
    expect(pricedTotal).toBe(30);
  });

  it("returns empty results for no add-ons", () => {
    expect(classifyAddOns([])).toEqual({ priced: [], pricedTotal: 0, manual: [] });
  });
});

// ---------------------------------------------------------------------------
// Complete Move-In/Move-Out package — Refrigerator/Oven/Cabinet Interior
// fold in automatically and must never remain independently chargeable.
// ---------------------------------------------------------------------------

describe("splitCompletePackageAddOns", () => {
  it("strips all three Complete-included add-ons and reports them as included", () => {
    const result = splitCompletePackageAddOns(["inside_refrigerator", "inside_oven", "inside_cabinets_drawers"]);
    expect(result.remaining).toEqual([]);
    expect(result.included.map((a) => a.id).sort()).toEqual(
      ["inside_cabinets_drawers", "inside_oven", "inside_refrigerator"].sort()
    );
  });

  it("also strips the Refrigerator + Oven Bundle if submitted alongside Complete", () => {
    const result = splitCompletePackageAddOns(["refrigerator_oven_bundle"]);
    expect(result.remaining).toEqual([]);
    expect(result.included).toEqual([{ id: "refrigerator_oven_bundle", label: "Refrigerator + Oven Bundle" }]);
  });

  it("leaves unrelated add-ons untouched", () => {
    const result = splitCompletePackageAddOns(["inside_oven", "extra_pet_hair_removal"]);
    expect(result.remaining).toEqual(["extra_pet_hair_removal"]);
    expect(result.included).toEqual([{ id: "inside_oven", label: "Oven Interior" }]);
  });

  it("a manipulated request submitting Complete-included items still charges them only once through the package (never standalone)", () => {
    const split = splitCompletePackageAddOns(["inside_refrigerator", "inside_oven", "inside_cabinets_drawers"]);
    const { pricedTotal } = classifyAddOns(split.remaining);
    expect(pricedTotal).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Quantified (per-unit) add-ons — Interior/Exterior Window Detailing, $10 each
// ---------------------------------------------------------------------------

describe("classifyQuantifiedAddOns", () => {
  it("returns empty results when nothing is selected", () => {
    expect(classifyQuantifiedAddOns(undefined)).toEqual({ priced: [], pricedTotal: 0 });
    expect(classifyQuantifiedAddOns([])).toEqual({ priced: [], pricedTotal: 0 });
  });

  it("prices interior window detailing at $10 per pane", () => {
    const result = classifyQuantifiedAddOns([{ id: "interior_window_detailing", quantity: 3 }]);
    expect(result.priced).toEqual([
      { id: "interior_window_detailing", label: "Interior Window Detailing", quantity: 3, amount: 30 },
    ]);
    expect(result.pricedTotal).toBe(30);
  });

  it("prices exterior window cleaning at $10 per pane", () => {
    const result = classifyQuantifiedAddOns([{ id: "exterior_window_cleaning", quantity: 2 }]);
    expect(result.pricedTotal).toBe(20);
  });

  it("sums repeated selections of the same id instead of overwriting", () => {
    const result = classifyQuantifiedAddOns([
      { id: "interior_window_detailing", quantity: 2 },
      { id: "interior_window_detailing", quantity: 1 },
    ]);
    expect(result.priced).toEqual([
      { id: "interior_window_detailing", label: "Interior Window Detailing", quantity: 3, amount: 30 },
    ]);
  });

  it("ignores a non-positive or non-integer quantity rather than inventing an amount", () => {
    const result = classifyQuantifiedAddOns([
      { id: "interior_window_detailing", quantity: 0 },
      { id: "exterior_window_cleaning", quantity: -1 },
      { id: "exterior_window_cleaning", quantity: 1.5 },
    ]);
    expect(result.priced).toEqual([]);
    expect(result.pricedTotal).toBe(0);
  });
});
