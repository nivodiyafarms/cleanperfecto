import { describe, expect, it } from "vitest";
import { getRoomAdjustment, ROOM_ADJUSTMENT_CONFIG, type RoomAdjustmentConfig } from "./room-adjustments";

// TEST-ONLY fixture — must never be copied into production config.
const TEST_ROOM_CONFIG: RoomAdjustmentConfig = {
  standard: { additionalBedroomCharge: 15, additionalFullBathroomCharge: 20, additionalHalfBathroomCharge: 10 },
  deep: { additionalBedroomCharge: 18, additionalFullBathroomCharge: 22, additionalHalfBathroomCharge: 11 },
  move: { additionalBedroomCharge: 18, additionalFullBathroomCharge: 22, additionalHalfBathroomCharge: 11 },
};

describe("getRoomAdjustment", () => {
  it("charges nothing when no room counts are provided", () => {
    expect(getRoomAdjustment("standard", "2br_2ba", undefined, TEST_ROOM_CONFIG)).toEqual({
      configured: true,
      amount: 0,
    });
  });

  it("charges nothing when actual rooms match the size tier's baseline", () => {
    expect(
      getRoomAdjustment(
        "standard",
        "2br_2ba",
        { bedrooms: 2, fullBathrooms: 2, halfBathrooms: 0 },
        TEST_ROOM_CONFIG
      )
    ).toEqual({ configured: true, amount: 0 });
  });

  it("charges nothing when actual rooms are below the baseline", () => {
    expect(
      getRoomAdjustment(
        "standard",
        "3br_2ba",
        { bedrooms: 2, fullBathrooms: 1, halfBathrooms: 0 },
        TEST_ROOM_CONFIG
      )
    ).toEqual({ configured: true, amount: 0 });
  });

  it("charges for extra bedrooms and bathrooms beyond the baseline, using the cleaning type's own rates", () => {
    // 2br/2ba baseline + 1 extra bedroom + 1 extra full bath + 1 half bath
    expect(
      getRoomAdjustment(
        "standard",
        "2br_2ba",
        { bedrooms: 3, fullBathrooms: 3, halfBathrooms: 1 },
        TEST_ROOM_CONFIG
      )
    ).toEqual({ configured: true, amount: 15 + 20 + 10 });

    expect(
      getRoomAdjustment(
        "deep",
        "2br_2ba",
        { bedrooms: 3, fullBathrooms: 3, halfBathrooms: 1 },
        TEST_ROOM_CONFIG
      )
    ).toEqual({ configured: true, amount: 18 + 22 + 11 });
  });

  it("returns a typed manual-review reason when an adjustment is needed but unconfigured", () => {
    const unconfigured: RoomAdjustmentConfig = {
      standard: { additionalBedroomCharge: null, additionalFullBathroomCharge: null, additionalHalfBathroomCharge: null },
      deep: { additionalBedroomCharge: null, additionalFullBathroomCharge: null, additionalHalfBathroomCharge: null },
      move: { additionalBedroomCharge: null, additionalFullBathroomCharge: null, additionalHalfBathroomCharge: null },
    };
    expect(
      getRoomAdjustment("standard", "2br_2ba", { bedrooms: 3, fullBathrooms: 2, halfBathrooms: 0 }, unconfigured)
    ).toEqual({ configured: false, reason: "ROOM_ADJUSTMENT_NOT_CONFIGURED" });
  });

  // ---------------------------------------------------------------------
  // Production config — owner-approved 2026-08-13
  // ---------------------------------------------------------------------

  describe("production ROOM_ADJUSTMENT_CONFIG", () => {
    it("matches the approved Standard rates: +$20 bedroom, +$25 full bath, +$12.50 half bath", () => {
      expect(ROOM_ADJUSTMENT_CONFIG.standard).toEqual({
        additionalBedroomCharge: 20,
        additionalFullBathroomCharge: 25,
        additionalHalfBathroomCharge: 12.5,
      });
    });

    it("matches the approved Deep rates: +$25 bedroom, +$30 full bath, +$15 half bath", () => {
      expect(ROOM_ADJUSTMENT_CONFIG.deep).toEqual({
        additionalBedroomCharge: 25,
        additionalFullBathroomCharge: 30,
        additionalHalfBathroomCharge: 15,
      });
    });

    it("Move-In/Move-Out shares Deep's approved rates", () => {
      expect(ROOM_ADJUSTMENT_CONFIG.move).toEqual(ROOM_ADJUSTMENT_CONFIG.deep);
    });

    it("3B2B Standard has no room adjustment (matches its own baseline)", () => {
      const result = getRoomAdjustment("standard", "3br_2ba", { bedrooms: 3, fullBathrooms: 2, halfBathrooms: 0 });
      expect(result).toEqual({ configured: true, amount: 0 });
    });

    it("3B3B Standard receives exactly one extra full-bath adjustment (+$25)", () => {
      const result = getRoomAdjustment("standard", "3br_2ba", { bedrooms: 3, fullBathrooms: 3, halfBathrooms: 0 });
      expect(result).toEqual({ configured: true, amount: 25 });
    });

    it("3B2.5B Standard receives exactly one half-bath adjustment (+$12.50)", () => {
      const result = getRoomAdjustment("standard", "3br_2ba", { bedrooms: 3, fullBathrooms: 2, halfBathrooms: 1 });
      expect(result).toEqual({ configured: true, amount: 12.5 });
    });

    it("5B3B receives exactly one additional-bedroom adjustment over the 4B base tier (+$20 Standard)", () => {
      // 4br_plus baseline is 4 bed / 3 full bath — a 5th bedroom is the only extra.
      const result = getRoomAdjustment("standard", "4br_plus", { bedrooms: 5, fullBathrooms: 3, halfBathrooms: 0 });
      expect(result).toEqual({ configured: true, amount: 20 });
    });

    it("4B3B has no room adjustment — the 3rd full bathroom is already included in the 4br_plus baseline", () => {
      const result = getRoomAdjustment("standard", "4br_plus", { bedrooms: 4, fullBathrooms: 3, halfBathrooms: 0 });
      expect(result).toEqual({ configured: true, amount: 0 });
    });

    it("a 4th full bathroom beyond the 4br_plus baseline is charged as an extra full bath", () => {
      const result = getRoomAdjustment("deep", "4br_plus", { bedrooms: 4, fullBathrooms: 4, halfBathrooms: 0 });
      expect(result).toEqual({ configured: true, amount: 30 });
    });

    it("owner worked example: 3 Bedroom / 3 Full Bathroom Standard totals $204 before size/condition", () => {
      const base = 179;
      const roomAdjustment = getRoomAdjustment("standard", "3br_2ba", {
        bedrooms: 3,
        fullBathrooms: 3,
        halfBathrooms: 0,
      });
      expect(roomAdjustment).toEqual({ configured: true, amount: 25 });
      expect(base + (roomAdjustment as { amount: number }).amount).toBe(204);
    });

    it("does not double-charge bedrooms or bathrooms already included in the size tier", () => {
      const result = getRoomAdjustment("standard", "1br_1ba", { bedrooms: 1, fullBathrooms: 1, halfBathrooms: 0 });
      expect(result).toEqual({ configured: true, amount: 0 });
    });
  });
});
