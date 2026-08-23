import { describe, expect, it } from "vitest";
import { addCadenceInterval, dayOfWeekForDate, generateCadenceDates } from "./recurrence-dates";

describe("dayOfWeekForDate", () => {
  it("returns 0-6 (Sunday-Saturday) for a calendar date, independent of local timezone", () => {
    // 2026-08-22 is a Saturday.
    expect(dayOfWeekForDate("2026-08-22")).toBe(6);
    // 2026-08-23 is a Sunday.
    expect(dayOfWeekForDate("2026-08-23")).toBe(0);
  });

  it("rejects malformed dates", () => {
    expect(() => dayOfWeekForDate("08/22/2026")).toThrow();
  });
});

describe("addCadenceInterval", () => {
  it("adds 7 days for weekly", () => {
    expect(addCadenceInterval("2026-08-22", "weekly")).toBe("2026-08-29");
  });

  it("adds 14 days for biweekly", () => {
    expect(addCadenceInterval("2026-08-22", "biweekly")).toBe("2026-09-05");
  });

  it("adds 28 days for every_4_weeks", () => {
    expect(addCadenceInterval("2026-08-22", "every_4_weeks")).toBe("2026-09-19");
  });

  it("correctly crosses a month/year boundary", () => {
    expect(addCadenceInterval("2026-12-29", "weekly")).toBe("2027-01-05");
  });
});

describe("generateCadenceDates", () => {
  it("generates the requested count, starting from and including firstDate", () => {
    expect(generateCadenceDates("2026-08-22", "weekly", 6)).toEqual([
      "2026-08-22",
      "2026-08-29",
      "2026-09-05",
      "2026-09-12",
      "2026-09-19",
      "2026-09-26",
    ]);
  });

  it("returns an empty array for count < 1", () => {
    expect(generateCadenceDates("2026-08-22", "weekly", 0)).toEqual([]);
  });

  it("returns just the first date for count = 1", () => {
    expect(generateCadenceDates("2026-08-22", "biweekly", 1)).toEqual(["2026-08-22"]);
  });
});
