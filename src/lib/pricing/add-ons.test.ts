import { describe, expect, it } from "vitest";
import { classifyAddOns } from "./add-ons";

describe("classifyAddOns", () => {
  it("prices Inside Oven at the approved fixed $35", () => {
    const { priced, pricedTotal, manual } = classifyAddOns(["inside_oven"]);
    expect(priced).toEqual([
      { id: "inside_oven", label: "Inside Oven", amount: 35, pricingKind: "fixed" },
    ]);
    expect(pricedTotal).toBe(35);
    expect(manual).toEqual([]);
  });

  it("prices Inside Refrigerator at the approved fixed $35", () => {
    const { priced, pricedTotal } = classifyAddOns(["inside_refrigerator"]);
    expect(priced).toEqual([
      { id: "inside_refrigerator", label: "Inside Refrigerator", amount: 35, pricingKind: "fixed" },
    ]);
    expect(pricedTotal).toBe(35);
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
    expect(pricedTotal).toBe(35);
  });

  it("deduplicates a repeated add-on id instead of double-charging", () => {
    const { priced, pricedTotal } = classifyAddOns(["inside_oven", "inside_oven"]);
    expect(priced).toHaveLength(1);
    expect(pricedTotal).toBe(35);
  });

  it("returns empty results for no add-ons", () => {
    expect(classifyAddOns([])).toEqual({ priced: [], pricedTotal: 0, manual: [] });
  });
});
