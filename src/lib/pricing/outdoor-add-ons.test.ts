import { describe, expect, it } from "vitest";
import { classifyOutdoorSelection } from "./outdoor-add-ons";

describe("classifyOutdoorSelection", () => {
  it("returns empty results when no outdoor selection is provided", () => {
    expect(classifyOutdoorSelection(undefined)).toEqual({ priced: [], pricedTotal: 0, manual: [], reasons: [] });
  });

  // ---------------------------------------------------------------------
  // Porch boundaries: 80/81/150/151/250/251
  // ---------------------------------------------------------------------
  describe("porch", () => {
    it.each([
      { sqFt: 80, expected: 30 },
      { sqFt: 81, expected: 45 },
      { sqFt: 150, expected: 45 },
      { sqFt: 151, expected: 60 },
      { sqFt: 250, expected: 60 },
    ])("$sqFt sq ft prices at $$expected", ({ sqFt, expected }) => {
      const result = classifyOutdoorSelection({ porchSqFt: sqFt });
      expect(result.priced).toEqual([{ id: "porch", label: "Porch Cleaning", amount: expected }]);
      expect(result.pricedTotal).toBe(expected);
    });

    it("251 sq ft requires a custom quote rather than an invented amount", () => {
      const result = classifyOutdoorSelection({ porchSqFt: 251 });
      expect(result.priced).toEqual([]);
      expect(result.manual).toEqual([{ id: "porch", label: "Porch Cleaning" }]);
      expect(result.reasons).toContain("PORCH_BEYOND_CONFIGURED_LIMIT");
      expect(result.pricedTotal).toBe(0);
    });
  });

  // ---------------------------------------------------------------------
  // Patio boundaries: 150/151/300/301/500/501
  // ---------------------------------------------------------------------
  describe("patio", () => {
    it.each([
      { sqFt: 150, expected: 45 },
      { sqFt: 151, expected: 65 },
      { sqFt: 300, expected: 65 },
      { sqFt: 301, expected: 90 },
      { sqFt: 500, expected: 90 },
    ])("$sqFt sq ft prices at $$expected", ({ sqFt, expected }) => {
      const result = classifyOutdoorSelection({ patioSqFt: sqFt });
      expect(result.priced).toEqual([{ id: "patio", label: "Patio Cleaning", amount: expected }]);
    });

    it("501 sq ft requires a custom quote rather than an invented amount", () => {
      const result = classifyOutdoorSelection({ patioSqFt: 501 });
      expect(result.priced).toEqual([]);
      expect(result.manual).toEqual([{ id: "patio", label: "Patio Cleaning" }]);
      expect(result.reasons).toContain("PATIO_BEYOND_CONFIGURED_LIMIT");
    });
  });

  // ---------------------------------------------------------------------
  // Garage: 1/2/3/>3 cars
  // ---------------------------------------------------------------------
  describe("garage", () => {
    it.each([
      { cars: 1, expected: 45 },
      { cars: 2, expected: 65 },
      { cars: 3, expected: 85 },
    ])("$cars-car garage prices at $$expected", ({ cars, expected }) => {
      const result = classifyOutdoorSelection({ garageCars: cars });
      expect(result.priced).toEqual([{ id: "garage", label: `Garage Cleaning (${cars}-Car)`, amount: expected }]);
    });

    it("more than 3 cars requires a custom quote rather than an invented amount", () => {
      const result = classifyOutdoorSelection({ garageCars: 4 });
      expect(result.priced).toEqual([]);
      expect(result.manual).toEqual([{ id: "garage", label: "Garage Cleaning" }]);
      expect(result.reasons).toContain("GARAGE_BEYOND_CONFIGURED_LIMIT");
    });
  });

  // ---------------------------------------------------------------------
  // Mixed configuration (section 13) — never incorrectly forced into a Trio
  // ---------------------------------------------------------------------
  it("prices a mixed configuration (1-car garage + medium porch + small patio) individually, never bundled", () => {
    const result = classifyOutdoorSelection({ garageCars: 1, porchSqFt: 100, patioSqFt: 100 });
    expect(result.priced).toEqual([
      { id: "porch", label: "Porch Cleaning", amount: 45 },
      { id: "patio", label: "Patio Cleaning", amount: 45 },
      { id: "garage", label: "Garage Cleaning (1-Car)", amount: 45 },
    ]);
    expect(result.pricedTotal).toBe(135);
  });

  // ---------------------------------------------------------------------
  // Trio: 99/149/199, and duplicate-charge prevention
  // ---------------------------------------------------------------------
  describe("Trio bundles", () => {
    it.each([
      { trio: "small" as const, expected: 99 },
      { trio: "medium" as const, expected: 149 },
      { trio: "large" as const, expected: 199 },
    ])("$trio Trio prices at $$expected", ({ trio, expected }) => {
      const result = classifyOutdoorSelection({ trio });
      expect(result.pricedTotal).toBe(expected);
    });

    it("Trio prevents a duplicate Porch/Patio/Garage charge even when dimensions are also submitted", () => {
      const result = classifyOutdoorSelection({ trio: "small", garageCars: 1, porchSqFt: 80, patioSqFt: 150 });
      expect(result.priced).toEqual([{ id: "trio", label: "Small Trio Bundle", amount: 99 }]);
      expect(result.pricedTotal).toBe(99);
    });

    it("rejects an invalid Trio capacity (dimensions exceeding the selected size) rather than silently truncating", () => {
      const result = classifyOutdoorSelection({ trio: "small", garageCars: 2 });
      expect(result.reasons).toContain("TRIO_CAPACITY_EXCEEDED");
      // Falls back to individual/custom pricing for the exceeded component — never silently bundled.
      expect(result.priced.find((p) => p.id === "trio")).toBeUndefined();
      expect(result.priced).toEqual([{ id: "garage", label: "Garage Cleaning (2-Car)", amount: 65 }]);
    });

    it("a mixed configuration with dimensions from different Trio sizes is not incorrectly bundled", () => {
      // 2-car garage (fits Medium) + large patio (fits Large only) — no single Trio covers both.
      const result = classifyOutdoorSelection({ garageCars: 2, patioSqFt: 500 });
      expect(result.priced).toEqual([
        { id: "patio", label: "Patio Cleaning", amount: 90 },
        { id: "garage", label: "Garage Cleaning (2-Car)", amount: 65 },
      ]);
    });
  });

  // ---------------------------------------------------------------------
  // Heavy garage oil & degrease: 1/2/3 bays
  // ---------------------------------------------------------------------
  describe("oil & degrease", () => {
    it.each([
      { bays: 1, expected: 40 },
      { bays: 2, expected: 80 },
      { bays: 3, expected: 120 },
    ])("$bays affected bay(s) prices at $$expected", ({ bays, expected }) => {
      const result = classifyOutdoorSelection({ garageCars: 3, oilDegreaseAffectedBays: bays });
      const oilCharge = result.priced.find((p) => p.id === "oil_degrease");
      expect(oilCharge?.amount).toBe(expected);
    });

    it("rejects affected bays exceeding the known garage capacity", () => {
      const result = classifyOutdoorSelection({ garageCars: 1, oilDegreaseAffectedBays: 3 });
      expect(result.reasons).toContain("OIL_DEGREASE_BAYS_EXCEED_GARAGE_CAPACITY");
      expect(result.priced.find((p) => p.id === "oil_degrease")).toBeUndefined();
    });

    it("validates against a Trio's included garage capacity when a Trio is applied", () => {
      const result = classifyOutdoorSelection({ trio: "small", oilDegreaseAffectedBays: 2 });
      expect(result.reasons).toContain("OIL_DEGREASE_BAYS_EXCEED_GARAGE_CAPACITY");
    });

    it("prices bays without a capacity check when the garage size genuinely isn't known", () => {
      const result = classifyOutdoorSelection({ oilDegreaseAffectedBays: 5 });
      expect(result.reasons).not.toContain("OIL_DEGREASE_BAYS_EXCEED_GARAGE_CAPACITY");
      expect(result.priced.find((p) => p.id === "oil_degrease")?.amount).toBe(200);
    });
  });

  // ---------------------------------------------------------------------
  // Black algae & mildew: 50/75/100
  // ---------------------------------------------------------------------
  describe("algae & mildew treatment", () => {
    it.each([
      { size: "small" as const, expected: 50 },
      { size: "medium" as const, expected: 75 },
      { size: "large" as const, expected: 100 },
    ])("$size treatment prices at $$expected", ({ size, expected }) => {
      const result = classifyOutdoorSelection({ algaeMildewTreatmentSize: size });
      expect(result.pricedTotal).toBe(expected);
    });
  });
});
