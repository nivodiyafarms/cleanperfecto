// Full pricing hierarchy invariant sweep, owner-required 2026-08-30:
//   STANDARD < DEEP <= BASIC MOVE < COMPLETE MOVE
// for equivalent property/configuration, wherever Complete is priceable.
//
// Uses the REAL production configuration (no test-fixture overrides) across
// a representative matrix of size tiers, conditions, and discount programs
// (including the $99 minimum and the 6+ prepaid package) — the exact
// interaction the owner asked to be inspected before trusting the
// hierarchy, not just a single hand-picked example.
import { describe, expect, it } from "vitest";
import { calculateEstimate } from "./calculate-estimate";
import type { CalculationInput, CleaningType, Condition, SizeTier } from "./types";

const ASOF_LAUNCH = new Date("2026-08-15T12:00:00-05:00"); // 30%-off launch window
const ASOF_STANDARD_OFFER = new Date("2026-09-05T00:00:00-05:00"); // 25%-off standard window
const ASOF_NO_OFFER = new Date("2026-06-01T12:00:00-05:00"); // before either offer's window is relevant to eligibility=false scenarios

const SIZE_TIERS: SizeTier[] = ["studio_1ba", "1br_1ba", "2br_2ba", "3br_2ba", "4br_plus"];
const COMMON_CONDITIONS: Condition[] = ["light", "moderate", "heavy"]; // Standard has no "extensive"
const MOVE_DEEP_CONDITIONS: Condition[] = ["light", "moderate", "heavy", "extensive"];

interface DiscountScenario {
  label: string;
  overrides: Partial<CalculationInput>;
}

const DISCOUNT_SCENARIOS: DiscountScenario[] = [
  { label: "one-time, no discount", overrides: { firstCleaningEligible: false, asOf: ASOF_NO_OFFER } },
  {
    label: "one-time, first-cleaning 30% (launch window)",
    overrides: { firstCleaningEligible: true, asOf: ASOF_LAUNCH },
  },
  {
    label: "one-time, first-cleaning 25% (standard window)",
    overrides: { firstCleaningEligible: true, asOf: ASOF_STANDARD_OFFER },
  },
  {
    label: "recurring weekly, not prepaid",
    overrides: { frequency: "weekly", isPrepaidPackage: false, firstCleaningEligible: false, asOf: ASOF_NO_OFFER },
  },
  {
    label: "recurring weekly, 6+ prepaid package",
    overrides: {
      frequency: "weekly",
      isPrepaidPackage: true,
      visitCount: 6,
      firstCleaningEligible: false,
      asOf: ASOF_NO_OFFER,
    },
  },
];

function baseInput(
  cleaningType: CleaningType,
  sizeTier: SizeTier,
  condition: Condition,
  scenario: DiscountScenario
): CalculationInput {
  return {
    propertyKind: "home",
    cleaningType,
    condition,
    sizeTier,
    zip: "75056", // Core / 0% — CleanPerfecto's own base ZIP
    frequency: "one_time",
    isPrepaidPackage: false,
    visitCount: 1,
    addOnIds: [],
    firstCleaningEligible: false,
    asOf: ASOF_NO_OFFER,
    ...scenario.overrides,
  };
}

// ---------------------------------------------------------------------------
// STANDARD < DEEP
// ---------------------------------------------------------------------------

describe("hierarchy invariant: STANDARD < DEEP", () => {
  const cases = SIZE_TIERS.flatMap((sizeTier) =>
    COMMON_CONDITIONS.flatMap((condition) =>
      DISCOUNT_SCENARIOS.map((scenario) => ({ sizeTier, condition, scenario }))
    )
  );

  it.each(cases)(
    "$sizeTier / $condition / $scenario.label: Standard strictly < Deep",
    ({ sizeTier, condition, scenario }) => {
      const standard = calculateEstimate(baseInput("standard", sizeTier, condition, scenario));
      const deep = calculateEstimate(baseInput("deep", sizeTier, condition, scenario));
      expect(standard.calculatedTotal).toBeLessThan(deep.calculatedTotal);
    }
  );

  it("documents the $99-floor interaction with a worked example: Standard studio + first-cleaning discount floors to exactly $99, while Deep studio (same discount) stays comfortably above it", () => {
    const scenario = DISCOUNT_SCENARIOS[1]; // 30% first-cleaning
    const standard = calculateEstimate(baseInput("standard", "studio_1ba", "light", scenario));
    const deep = calculateEstimate(baseInput("deep", "studio_1ba", "light", scenario));
    expect(standard.minimumServiceTotalApplied).toBe(true);
    expect(standard.calculatedTotal).toBe(99);
    expect(deep.minimumServiceTotalApplied).toBe(false);
    expect(deep.calculatedTotal).toBeGreaterThan(99);
    expect(standard.calculatedTotal).toBeLessThan(deep.calculatedTotal);
  });
});

// ---------------------------------------------------------------------------
// DEEP <= BASIC MOVE (guaranteed by construction — calculate-estimate.ts
// takes max(rawBasicMoveTotal, equivalentDeepTotal) — verified here across
// the same matrix rather than trusted blindly)
// ---------------------------------------------------------------------------

describe("hierarchy invariant: DEEP <= BASIC MOVE", () => {
  const cases = SIZE_TIERS.flatMap((sizeTier) =>
    MOVE_DEEP_CONDITIONS.flatMap((condition) =>
      DISCOUNT_SCENARIOS.map((scenario) => ({ sizeTier, condition, scenario }))
    )
  );

  it.each(cases)(
    "$sizeTier / $condition / $scenario.label: Deep <= Basic Move",
    ({ sizeTier, condition, scenario }) => {
      const deep = calculateEstimate(baseInput("deep", sizeTier, condition, scenario));
      const move = calculateEstimate({ ...baseInput("move", sizeTier, condition, scenario), movePackageLevel: "basic" });
      expect(deep.calculatedTotal).toBeLessThanOrEqual(move.calculatedTotal);
      expect(move.moveEquivalentDeepTotal).toBe(deep.calculatedTotal);
    }
  );
});

// ---------------------------------------------------------------------------
// Estimate-range invariants — the CUSTOMER-FACING range (not just the raw
// total) must never show Basic Move below equivalent Deep, or Complete
// below Basic, on EITHER bound. Verified directly across the full matrix
// rather than assumed from "both use the same rounding formula".
// ---------------------------------------------------------------------------

describe("estimate-range invariant: Deep's range never displays above Basic Move's range", () => {
  const cases = SIZE_TIERS.flatMap((sizeTier) =>
    MOVE_DEEP_CONDITIONS.flatMap((condition) =>
      DISCOUNT_SCENARIOS.map((scenario) => ({ sizeTier, condition, scenario }))
    )
  );

  it.each(cases)(
    "$sizeTier / $condition / $scenario.label: deep.range <= basicMove.range on both bounds",
    ({ sizeTier, condition, scenario }) => {
      const deep = calculateEstimate(baseInput("deep", sizeTier, condition, scenario));
      const move = calculateEstimate({ ...baseInput("move", sizeTier, condition, scenario), movePackageLevel: "basic" });
      expect(deep.range).not.toBeNull();
      expect(move.range).not.toBeNull();
      expect(deep.range!.lower).toBeLessThanOrEqual(move.range!.lower);
      expect(deep.range!.upper).toBeLessThanOrEqual(move.range!.upper);
    }
  );
});

describe("estimate-range invariant: Basic Move's range never displays above Complete Move's range", () => {
  const cases = SIZE_TIERS.flatMap((sizeTier) =>
    MOVE_DEEP_CONDITIONS.flatMap((condition) =>
      DISCOUNT_SCENARIOS.map((scenario) => ({ sizeTier, condition, scenario }))
    )
  );

  it.each(cases)(
    "$sizeTier / $condition / $scenario.label: basicMove.range < completeMove.range on both bounds",
    ({ sizeTier, condition, scenario }) => {
      const basic = calculateEstimate({
        ...baseInput("move", sizeTier, condition, scenario),
        movePackageLevel: "basic",
      });
      const complete = calculateEstimate({
        ...baseInput("move", sizeTier, condition, scenario),
        movePackageLevel: "complete",
      });
      expect(complete.moveCompleteUpgradeConfigured).toBe(true);
      expect(basic.range!.lower).toBeLessThan(complete.range!.lower);
      expect(basic.range!.upper).toBeLessThanOrEqual(complete.range!.upper);
    }
  );
});

// ---------------------------------------------------------------------------
// BASIC MOVE < COMPLETE MOVE, wherever Complete is priceable
// ---------------------------------------------------------------------------

describe("hierarchy invariant: BASIC MOVE < COMPLETE MOVE (wherever Complete is priceable)", () => {
  const cases = SIZE_TIERS.flatMap((sizeTier) =>
    MOVE_DEEP_CONDITIONS.flatMap((condition) =>
      DISCOUNT_SCENARIOS.map((scenario) => ({ sizeTier, condition, scenario }))
    )
  );

  it.each(cases)(
    "$sizeTier / $condition / $scenario.label: Complete strictly > Basic",
    ({ sizeTier, condition, scenario }) => {
      const basic = calculateEstimate({
        ...baseInput("move", sizeTier, condition, scenario),
        movePackageLevel: "basic",
      });
      const complete = calculateEstimate({
        ...baseInput("move", sizeTier, condition, scenario),
        movePackageLevel: "complete",
      });
      // Every size tier's default effective square footage (its own
      // included allowance) is well under 4,500 sq ft, so Complete is
      // always priceable in this matrix — see the dedicated ">4,500 sq ft"
      // test elsewhere for the unpriceable case.
      expect(complete.moveCompleteUpgradeConfigured).toBe(true);
      expect(complete.calculatedTotal).toBeGreaterThan(basic.calculatedTotal);
    }
  );
});

// ---------------------------------------------------------------------------
// Full chain, single worked examples printed for the report (task 9 asks
// for representative totals/ranges to be shown, not just asserted).
// ---------------------------------------------------------------------------

describe("full chain worked examples (exact figures, for reporting and regression)", () => {
  it("3 Bedroom / 2 Bath, Moderate, one-time, no discount: $201.50 < $309 <= $309 < $374", () => {
    const scenario = DISCOUNT_SCENARIOS[0];
    const standard = calculateEstimate(baseInput("standard", "3br_2ba", "moderate", scenario));
    const deep = calculateEstimate(baseInput("deep", "3br_2ba", "moderate", scenario));
    const basic = calculateEstimate({
      ...baseInput("move", "3br_2ba", "moderate", scenario),
      movePackageLevel: "basic",
    });
    const complete = calculateEstimate({
      ...baseInput("move", "3br_2ba", "moderate", scenario),
      movePackageLevel: "complete",
    });

    expect(standard.calculatedTotal).toBe(201.5);
    expect(standard.range).toEqual({ lower: 205, upper: 230 });
    expect(deep.calculatedTotal).toBe(309);
    expect(deep.range).toEqual({ lower: 310, upper: 335 });
    expect(basic.calculatedTotal).toBe(309); // floor applied — equals equivalent Deep exactly
    expect(basic.moveFloorApplied).toBe(true);
    expect(basic.range).toEqual({ lower: 310, upper: 335 });
    expect(complete.calculatedTotal).toBe(374); // 309 + $65 (2201-3000 sq ft band upgrade)
    expect(complete.moveCompleteUpgrade).toBe(65);
    expect(complete.range).toEqual({ lower: 375, upper: 405 });
  });

  it("4+ Bedroom, Heavy, 6+ prepaid weekly package — the scenario most likely to engage the Move floor (Move's flat $199 base vs Deep's $329 base): $198.39 < $304.01 <= $304.01 < $384.01", () => {
    const scenario = DISCOUNT_SCENARIOS[4];
    const standard = calculateEstimate(baseInput("standard", "4br_plus", "heavy", scenario));
    const deep = calculateEstimate(baseInput("deep", "4br_plus", "heavy", scenario));
    const basic = calculateEstimate({
      ...baseInput("move", "4br_plus", "heavy", scenario),
      movePackageLevel: "basic",
    });
    const complete = calculateEstimate({
      ...baseInput("move", "4br_plus", "heavy", scenario),
      movePackageLevel: "complete",
    });

    expect(standard.calculatedTotal).toBe(198.39);
    expect(standard.range).toEqual({ lower: 200, upper: 230 });
    expect(deep.calculatedTotal).toBe(304.01);
    expect(deep.range).toEqual({ lower: 305, upper: 335 });
    expect(basic.calculatedTotal).toBe(304.01); // floor applied — Move's own weekly-package total would otherwise be lower
    expect(basic.moveFloorApplied).toBe(true);
    expect(basic.range).toEqual({ lower: 305, upper: 335 });
    expect(complete.calculatedTotal).toBe(384.01); // 304.01 + $80 (3000 sq ft included allowance -> 2501-3500 band)
    expect(complete.moveCompleteUpgrade).toBe(80);
    expect(complete.range).toEqual({ lower: 385, upper: 425 });
  });

  it("Studio Light, one-time, 30% first-cleaning (launch): $99 < $143.30 < $164.30 < $214.30", () => {
    const overrides = { firstCleaningEligible: true, asOf: new Date("2026-08-15T12:00:00-05:00") };
    const standard = calculateEstimate({ ...baseInput("standard", "studio_1ba", "light", DISCOUNT_SCENARIOS[0]), ...overrides });
    const deep = calculateEstimate({ ...baseInput("deep", "studio_1ba", "light", DISCOUNT_SCENARIOS[0]), ...overrides });
    const basic = calculateEstimate({
      ...baseInput("move", "studio_1ba", "light", DISCOUNT_SCENARIOS[0]),
      ...overrides,
      movePackageLevel: "basic",
    });
    const complete = calculateEstimate({
      ...baseInput("move", "studio_1ba", "light", DISCOUNT_SCENARIOS[0]),
      ...overrides,
      movePackageLevel: "complete",
    });

    expect(standard.calculatedTotal).toBe(99); // $99 floor engaged
    expect(standard.minimumServiceTotalApplied).toBe(true);
    expect(deep.calculatedTotal).toBe(143.3);
    expect(basic.calculatedTotal).toBe(164.3); // Move's own total already exceeds Deep — floor not needed here
    expect(basic.moveFloorApplied).toBe(false);
    expect(complete.calculatedTotal).toBe(214.3); // 164.30 + $50 (up to 1,500 sq ft band upgrade)

    expect(standard.calculatedTotal).toBeLessThan(deep.calculatedTotal);
    expect(deep.calculatedTotal).toBeLessThanOrEqual(basic.calculatedTotal);
    expect(basic.calculatedTotal).toBeLessThan(complete.calculatedTotal);
  });
});
