import { describe, expect, it } from "vitest";
import { getSuppliesEquipmentCharge, type SuppliesEquipmentRule } from "./supplies-equipment";

// TEST-ONLY fixtures — must never be copied into production config.
const TEST_SUPPLIES_CONFIG: SuppliesEquipmentRule[] = [
  { cleaningType: "standard", sizeTier: "studio_1ba", amount: 15 },
  { cleaningType: "deep", sizeTier: "studio_1ba", amount: 25 },
];

describe("getSuppliesEquipmentCharge", () => {
  it("returns the configured amount for a matching service type and size tier", () => {
    expect(getSuppliesEquipmentCharge("standard", "studio_1ba", TEST_SUPPLIES_CONFIG)).toEqual({
      configured: true,
      amount: 15,
    });
  });

  it("does not reuse one universal charge across different service types", () => {
    expect(getSuppliesEquipmentCharge("deep", "studio_1ba", TEST_SUPPLIES_CONFIG)).toEqual({
      configured: true,
      amount: 25,
    });
  });

  it("returns a typed manual-review reason when the combination is unconfigured", () => {
    expect(getSuppliesEquipmentCharge("standard", "4br_plus", TEST_SUPPLIES_CONFIG)).toEqual({
      configured: false,
      reason: "SUPPLIES_EQUIPMENT_NOT_CONFIGURED",
    });
  });

  it("production SUPPLIES_EQUIPMENT_CONFIG is empty until approved amounts are supplied", async () => {
    const { SUPPLIES_EQUIPMENT_CONFIG } = await import("./supplies-equipment");
    expect(SUPPLIES_EQUIPMENT_CONFIG).toEqual([]);
  });

  it("defaults to the (empty) production config when none is injected", () => {
    expect(getSuppliesEquipmentCharge("standard", "studio_1ba")).toEqual({
      configured: false,
      reason: "SUPPLIES_EQUIPMENT_NOT_CONFIGURED",
    });
  });
});
