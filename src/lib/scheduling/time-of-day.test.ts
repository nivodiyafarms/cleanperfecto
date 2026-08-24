import { describe, expect, it } from "vitest";
import { intervalsOverlap, minutesToTime, timeToMinutes } from "./time-of-day";

describe("timeToMinutes / minutesToTime", () => {
  it("round-trips HH:MM through minutes", () => {
    expect(timeToMinutes("08:00")).toBe(480);
    expect(timeToMinutes("17:00")).toBe(1020);
    expect(timeToMinutes("23:59")).toBe(1439);
    expect(minutesToTime(480)).toBe("08:00");
    expect(minutesToTime(1020)).toBe("17:00");
  });

  it("rejects malformed times", () => {
    expect(() => timeToMinutes("8:00")).toThrow();
    expect(() => timeToMinutes("24:00")).toThrow();
    expect(() => timeToMinutes("not-a-time")).toThrow();
  });

  it("tolerates the :SS suffix Postgres always includes when a time column round-trips through PostgREST", () => {
    // Every write path in this codebase only ever produces "HH:MM", but a
    // real `time` column (recurring_visit_plans.planned_start_time,
    // cleaner_availability_rules.start_time, etc.) always comes back with
    // seconds — this must not break parsing of a freshly-read DB row.
    expect(timeToMinutes("08:00:00")).toBe(480);
    expect(timeToMinutes("17:30:45")).toBe(1050);
    expect(() => timeToMinutes("08:00:60")).toThrow(); // still rejects a genuinely invalid seconds component
  });

  it("normalizes minutes past midnight when formatting", () => {
    expect(minutesToTime(1440)).toBe("00:00");
    expect(minutesToTime(1500)).toBe("01:00");
  });
});

describe("intervalsOverlap", () => {
  it("detects overlap", () => {
    expect(intervalsOverlap({ start: 480, end: 600 }, { start: 540, end: 660 })).toBe(true);
  });

  it("treats touching-but-not-crossing intervals as non-overlapping (half-open)", () => {
    expect(intervalsOverlap({ start: 480, end: 600 }, { start: 600, end: 660 })).toBe(false);
  });

  it("detects non-overlap when clearly separate", () => {
    expect(intervalsOverlap({ start: 480, end: 600 }, { start: 700, end: 800 })).toBe(false);
  });
});
