import { describe, expect, it } from "vitest";
import { getRoomAdjustment, type RoomAdjustmentConfig } from "./room-adjustments";

// TEST-ONLY fixture — must never be copied into production config.
const TEST_ROOM_CONFIG: RoomAdjustmentConfig = {
  additionalBedroomCharge: 15,
  additionalFullBathroomCharge: 20,
  additionalHalfBathroomCharge: 10,
};

describe("getRoomAdjustment", () => {
  it("charges nothing when no room counts are provided", () => {
    expect(getRoomAdjustment("2br_2ba", undefined, TEST_ROOM_CONFIG)).toEqual({
      configured: true,
      amount: 0,
    });
  });

  it("charges nothing when actual rooms match the size tier's baseline", () => {
    expect(
      getRoomAdjustment(
        "2br_2ba",
        { bedrooms: 2, fullBathrooms: 2, halfBathrooms: 0 },
        TEST_ROOM_CONFIG
      )
    ).toEqual({ configured: true, amount: 0 });
  });

  it("charges nothing when actual rooms are below the baseline", () => {
    expect(
      getRoomAdjustment(
        "3br_2ba",
        { bedrooms: 2, fullBathrooms: 1, halfBathrooms: 0 },
        TEST_ROOM_CONFIG
      )
    ).toEqual({ configured: true, amount: 0 });
  });

  it("charges for extra bedrooms and bathrooms beyond the baseline", () => {
    // 2br/2ba baseline + 1 extra bedroom + 1 extra full bath + 1 half bath
    expect(
      getRoomAdjustment(
        "2br_2ba",
        { bedrooms: 3, fullBathrooms: 3, halfBathrooms: 1 },
        TEST_ROOM_CONFIG
      )
    ).toEqual({ configured: true, amount: 15 + 20 + 10 });
  });

  it("returns a typed manual-review reason when an adjustment is needed but unconfigured", () => {
    const unconfigured: RoomAdjustmentConfig = {
      additionalBedroomCharge: null,
      additionalFullBathroomCharge: null,
      additionalHalfBathroomCharge: null,
    };
    expect(
      getRoomAdjustment("2br_2ba", { bedrooms: 3, fullBathrooms: 2, halfBathrooms: 0 }, unconfigured)
    ).toEqual({ configured: false, reason: "ROOM_ADJUSTMENT_NOT_CONFIGURED" });
  });

  it("production ROOM_ADJUSTMENT_CONFIG is unconfigured until approved amounts are supplied", async () => {
    const { ROOM_ADJUSTMENT_CONFIG } = await import("./room-adjustments");
    expect(ROOM_ADJUSTMENT_CONFIG).toEqual({
      additionalBedroomCharge: null,
      additionalFullBathroomCharge: null,
      additionalHalfBathroomCharge: null,
    });
  });
});
