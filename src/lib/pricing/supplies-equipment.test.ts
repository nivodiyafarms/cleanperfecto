import { describe, expect, it } from "vitest";
import {
  AIRBNB_SUPPLIES_CONFIG,
  getAirbnbSuppliesCharge,
  getSuppliesEquipmentCharge,
  SUPPLIES_EQUIPMENT_CONFIG,
  type AirbnbSuppliesRule,
  type SuppliesEquipmentRule,
} from "./supplies-equipment";

// TEST-ONLY fixtures — must never be copied into production config.
const TEST_SUPPLIES_CONFIG: SuppliesEquipmentRule[] = [
  { cleaningType: "standard", minSqFt: 0, maxSqFt: 1000, amount: 15 },
  { cleaningType: "deep", minSqFt: 0, maxSqFt: 1000, amount: 25 },
];

describe("getSuppliesEquipmentCharge", () => {
  it("returns the configured amount for a matching service type and square-footage band", () => {
    expect(getSuppliesEquipmentCharge("standard", 800, TEST_SUPPLIES_CONFIG)).toEqual({
      configured: true,
      amount: 15,
    });
  });

  it("does not reuse one universal charge across different service types", () => {
    expect(getSuppliesEquipmentCharge("deep", 800, TEST_SUPPLIES_CONFIG)).toEqual({
      configured: true,
      amount: 25,
    });
  });

  it("returns a typed manual-review reason when the combination is unconfigured", () => {
    expect(getSuppliesEquipmentCharge("standard", 5000, TEST_SUPPLIES_CONFIG)).toEqual({
      configured: false,
      reason: "SUPPLIES_EQUIPMENT_NOT_CONFIGURED",
    });
  });

  it("defaults to the (real) production config when none is injected", () => {
    expect(getSuppliesEquipmentCharge("standard", 800)).toEqual({ configured: true, amount: 15 });
  });
});

// ---------------------------------------------------------------------------
// Production config — owner-approved 2026-08-13
// ---------------------------------------------------------------------------

describe("production SUPPLIES_EQUIPMENT_CONFIG", () => {
  it("never uses one universal flat charge across cleaning types or bands", () => {
    const amounts = new Set(SUPPLIES_EQUIPMENT_CONFIG.map((rule) => rule.amount));
    expect(amounts.size).toBeGreaterThan(1);
  });

  describe.each([
    {
      label: "Standard",
      cleaningType: "standard" as const,
      bands: [
        { sqft: 1000, expected: 15 },
        { sqft: 1001, expected: 22.5 },
        { sqft: 2200, expected: 22.5 },
        { sqft: 2201, expected: 27.5 },
        { sqft: 3000, expected: 27.5 },
        { sqft: 3001, expected: 32.5 },
        { sqft: 4500, expected: 32.5 },
      ],
    },
    {
      label: "Deep",
      cleaningType: "deep" as const,
      bands: [
        { sqft: 1000, expected: 25 },
        { sqft: 1001, expected: 30 },
        { sqft: 2200, expected: 30 },
        { sqft: 2201, expected: 35 },
        { sqft: 3000, expected: 35 },
        { sqft: 3001, expected: 42.5 },
        { sqft: 4500, expected: 42.5 },
      ],
    },
    {
      label: "Move-In/Out",
      cleaningType: "move" as const,
      bands: [
        { sqft: 1000, expected: 25 },
        { sqft: 1001, expected: 32.5 },
        { sqft: 2200, expected: 32.5 },
        { sqft: 2201, expected: 40 },
        { sqft: 3000, expected: 40 },
        { sqft: 3001, expected: 47.5 },
        { sqft: 4500, expected: 47.5 },
      ],
    },
  ])("$label", ({ cleaningType, bands }) => {
    it.each(bands)("$sqft sq ft resolves to $$expected", ({ sqft, expected }) => {
      expect(getSuppliesEquipmentCharge(cleaningType, sqft, SUPPLIES_EQUIPMENT_CONFIG)).toEqual({
        configured: true,
        amount: expected,
      });
    });

    it("beyond 4,500 sq ft (4501) requires manual review, never an invented amount", () => {
      expect(getSuppliesEquipmentCharge(cleaningType, 4501, SUPPLIES_EQUIPMENT_CONFIG)).toEqual({
        configured: false,
        reason: "SUPPLIES_EQUIPMENT_NOT_CONFIGURED",
      });
    });
  });
});

// ---------------------------------------------------------------------------
// getAirbnbSuppliesCharge — Airbnb has its own sq-ft-only schedule,
// independent of CleaningType (owner-approved 2026-08-13, milestone
// correction #2)
// ---------------------------------------------------------------------------

describe("getAirbnbSuppliesCharge", () => {
  // TEST-ONLY fixture — must never be copied into production config.
  const TEST_AIRBNB_CONFIG: AirbnbSuppliesRule[] = [{ minSqFt: 0, maxSqFt: 1000, amount: 12 }];

  it("returns the configured amount for a matching square-footage band", () => {
    expect(getAirbnbSuppliesCharge(800, TEST_AIRBNB_CONFIG)).toEqual({ configured: true, amount: 12 });
  });

  it("returns a typed manual-review reason when square footage is unconfigured", () => {
    expect(getAirbnbSuppliesCharge(5000, TEST_AIRBNB_CONFIG)).toEqual({
      configured: false,
      reason: "SUPPLIES_EQUIPMENT_NOT_CONFIGURED",
    });
  });

  it("defaults to the (real) production Airbnb config when none is injected", () => {
    expect(getAirbnbSuppliesCharge(800)).toEqual({ configured: true, amount: 15 });
  });
});

describe("production AIRBNB_SUPPLIES_CONFIG", () => {
  it("differs from the Standard/Deep/Move schedule — Airbnb is not simply reusing another table", () => {
    const standardAmounts = new Set(SUPPLIES_EQUIPMENT_CONFIG.map((r) => r.amount));
    const airbnbAmounts = new Set(AIRBNB_SUPPLIES_CONFIG.map((r) => r.amount));
    expect(airbnbAmounts).not.toEqual(standardAmounts);
  });

  it.each([
    { sqft: 1000, expected: 15 },
    { sqft: 1001, expected: 20 },
    { sqft: 2200, expected: 20 },
    { sqft: 2201, expected: 25 },
    { sqft: 3000, expected: 25 },
    { sqft: 3001, expected: 30 },
    { sqft: 4500, expected: 30 },
  ])("$sqft sq ft resolves to $$expected", ({ sqft, expected }) => {
    expect(getAirbnbSuppliesCharge(sqft, AIRBNB_SUPPLIES_CONFIG)).toEqual({ configured: true, amount: expected });
  });

  it("beyond 4,500 sq ft (4501) requires manual review, never an invented amount", () => {
    expect(getAirbnbSuppliesCharge(4501, AIRBNB_SUPPLIES_CONFIG)).toEqual({
      configured: false,
      reason: "SUPPLIES_EQUIPMENT_NOT_CONFIGURED",
    });
  });
});
