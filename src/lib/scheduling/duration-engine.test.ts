import { describe, expect, it } from "vitest";
import { BASE_LABOR_MINUTES, RECOMMENDED_CLEANER_COUNT } from "./config";
import { estimateDuration } from "./duration-engine";

describe("estimateDuration", () => {
  it("uses the base labor minutes for a size tier with no extra rooms and light condition", () => {
    const result = estimateDuration({ cleaningType: "standard", sizeTier: "2br_2ba", condition: "light" });
    expect(result.estimatedLaborMinutes).toBe(BASE_LABOR_MINUTES.standard["2br_2ba"]);
    expect(result.recommendedCleanerCount).toBe(RECOMMENDED_CLEANER_COUNT["2br_2ba"]);
  });

  it("charges nothing extra when actual rooms match or fall below the size tier baseline", () => {
    const atBaseline = estimateDuration({
      cleaningType: "standard",
      sizeTier: "2br_2ba",
      condition: "light",
      rooms: { bedrooms: 2, fullBathrooms: 2, halfBathrooms: 0 },
    });
    expect(atBaseline.estimatedLaborMinutes).toBe(BASE_LABOR_MINUTES.standard["2br_2ba"]);
  });

  it("adds minutes for rooms beyond the size tier baseline", () => {
    // 2br_2ba baseline is 2 bedrooms / 2 full baths / 0 half baths.
    const result = estimateDuration({
      cleaningType: "standard",
      sizeTier: "2br_2ba",
      condition: "light",
      rooms: { bedrooms: 3, fullBathrooms: 3, halfBathrooms: 1 },
    });
    // +1 bedroom (15) + 1 full bath (20) + 1 half bath (10) = +45
    expect(result.estimatedLaborMinutes).toBe(BASE_LABOR_MINUTES.standard["2br_2ba"] + 45);
  });

  it("applies the condition multiplier on top of base + room minutes", () => {
    const light = estimateDuration({ cleaningType: "standard", sizeTier: "2br_2ba", condition: "light" });
    const heavy = estimateDuration({ cleaningType: "standard", sizeTier: "2br_2ba", condition: "heavy" });
    // heavy = 1.15x per CONDITION_MULTIPLIERS
    expect(heavy.estimatedLaborMinutes).toBe(Math.round(light.estimatedLaborMinutes * 1.15));
  });

  it("Move reuses Deep's base labor minutes for the same size tier (Move already reuses Deep's room-adjustment rates in pricing)", () => {
    const deep = estimateDuration({ cleaningType: "deep", sizeTier: "3br_2ba", condition: "light" });
    const move = estimateDuration({ cleaningType: "move", sizeTier: "3br_2ba", condition: "light" });
    expect(move.estimatedLaborMinutes).toBe(deep.estimatedLaborMinutes);
  });

  it("derives estimatedServiceMinutes from labor minutes / recommended cleaner count, rounded up to the nearest 15", () => {
    const result = estimateDuration({ cleaningType: "standard", sizeTier: "3br_2ba", condition: "light" });
    expect(result.recommendedCleanerCount).toBe(2);
    const raw = Math.ceil(result.estimatedLaborMinutes / 2);
    expect(result.estimatedServiceMinutes).toBe(Math.ceil(raw / 15) * 15);
    expect(result.estimatedServiceMinutes % 15).toBe(0);
  });

  it("is deterministic — same input always produces the same result", () => {
    const input = { cleaningType: "deep" as const, sizeTier: "4br_plus" as const, condition: "extensive" as const };
    expect(estimateDuration(input)).toEqual(estimateDuration(input));
  });
});
