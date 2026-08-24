import { describe, expect, it } from "vitest";
import { utcToZonedDateTime, zonedDateTimeToUtc } from "./timezone";

describe("zonedDateTimeToUtc / utcToZonedDateTime", () => {
  it("round-trips a date/time through a fixed zone (UTC)", () => {
    const instant = zonedDateTimeToUtc("2026-08-24", "14:30", "UTC");
    expect(instant.toISOString()).toBe("2026-08-24T14:30:00.000Z");
    expect(utcToZonedDateTime(instant, "UTC")).toEqual({ date: "2026-08-24", time: "14:30" });
  });

  it("tolerates the :SS suffix Postgres always includes when a time column round-trips through PostgREST", () => {
    // recurring_visit_plans.planned_start_time / package_visit_plans.planned_start_time
    // etc. always come back from a real `time` column as "HH:MM:SS" — a
    // domain function reading a freshly-fetched plan row must not choke on it.
    const instant = zonedDateTimeToUtc("2026-08-24", "10:00:00", "America/Chicago");
    expect(instant.toISOString()).toBe("2026-08-24T15:00:00.000Z");
  });

  it("converts America/Chicago wall time to UTC correctly during CDT (summer, UTC-5)", () => {
    const instant = zonedDateTimeToUtc("2026-08-24", "10:00", "America/Chicago");
    expect(instant.toISOString()).toBe("2026-08-24T15:00:00.000Z");
  });

  it("converts America/Chicago wall time to UTC correctly during CST (winter, UTC-6)", () => {
    const instant = zonedDateTimeToUtc("2026-01-15", "10:00", "America/Chicago");
    expect(instant.toISOString()).toBe("2026-01-15T16:00:00.000Z");
  });

  it("round-trips across the spring-forward DST transition", () => {
    // 2026-03-08 is the US spring-forward date; 10:00 local is unambiguous
    // (the gap is 2:00-3:00 AM), and should convert to UTC-5 (CDT) already
    // in effect by mid-morning.
    const instant = zonedDateTimeToUtc("2026-03-08", "10:00", "America/Chicago");
    const back = utcToZonedDateTime(instant, "America/Chicago");
    expect(back).toEqual({ date: "2026-03-08", time: "10:00" });
  });

  it("is deterministic", () => {
    const a = zonedDateTimeToUtc("2026-08-24", "17:00", "America/Chicago");
    const b = zonedDateTimeToUtc("2026-08-24", "17:00", "America/Chicago");
    expect(a.getTime()).toBe(b.getTime());
  });
});
