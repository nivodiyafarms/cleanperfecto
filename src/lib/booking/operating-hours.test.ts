import { describe, expect, it } from "vitest";
import { isWithinOperatingHours, OPERATING_HOURS_END, OPERATING_HOURS_START } from "./operating-hours";

describe("isWithinOperatingHours", () => {
  it("accepts the exact boundary times", () => {
    expect(isWithinOperatingHours(OPERATING_HOURS_START)).toBe(true);
    expect(isWithinOperatingHours(OPERATING_HOURS_END)).toBe(true);
  });

  it("accepts times inside the window", () => {
    expect(isWithinOperatingHours("09:30")).toBe(true);
    expect(isWithinOperatingHours("12:00")).toBe(true);
    expect(isWithinOperatingHours("17:59")).toBe(true);
  });

  it("rejects times before the window", () => {
    expect(isWithinOperatingHours("07:59")).toBe(false);
    expect(isWithinOperatingHours("00:00")).toBe(false);
  });

  it("rejects times after the window", () => {
    expect(isWithinOperatingHours("18:01")).toBe(false);
    expect(isWithinOperatingHours("23:59")).toBe(false);
  });

  it("rejects malformed input rather than guessing", () => {
    expect(isWithinOperatingHours("")).toBe(false);
    expect(isWithinOperatingHours("9:30")).toBe(false); // not zero-padded
    expect(isWithinOperatingHours("25:00")).toBe(false);
    expect(isWithinOperatingHours("not-a-time")).toBe(false);
  });
});
