import { describe, expect, it } from "vitest";
import { formatRequestedStartTime } from "./format-start-time";

describe("formatRequestedStartTime", () => {
  it("formats a morning time", () => {
    expect(formatRequestedStartTime("09:00")).toBe("9:00 AM");
  });

  it("formats an afternoon/evening time", () => {
    expect(formatRequestedStartTime("14:30")).toBe("2:30 PM");
    expect(formatRequestedStartTime("17:59")).toBe("5:59 PM");
  });

  it("formats noon and midnight correctly (12-hour edge cases)", () => {
    expect(formatRequestedStartTime("12:00")).toBe("12:00 PM");
    expect(formatRequestedStartTime("00:00")).toBe("12:00 AM");
  });

  it("handles a Postgres time column's HH:MM:SS shape", () => {
    expect(formatRequestedStartTime("08:00:00")).toBe("8:00 AM");
  });

  it("returns null for null/empty input rather than inventing a time", () => {
    expect(formatRequestedStartTime(null)).toBeNull();
    expect(formatRequestedStartTime("")).toBeNull();
  });
});
