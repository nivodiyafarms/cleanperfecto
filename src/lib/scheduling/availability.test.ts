import { describe, expect, it } from "vitest";
import {
  computeAvailableCleaners,
  computeAvailableStartTimes,
  type AvailabilityContext,
  type AvailabilityQuery,
  type AvailableCleanersQuery,
} from "./availability";

const DATE = "2026-08-24"; // a Monday

function baseQuery(overrides: Partial<AvailabilityQuery> = {}): AvailabilityQuery {
  return {
    date: DATE,
    serviceMinutes: 120,
    bufferMinutes: 60,
    requiredCleanerCount: 1,
    ...overrides,
  };
}

function baseContext(overrides: Partial<AvailabilityContext> = {}): AvailabilityContext {
  return {
    activeCleanerIds: ["cleaner-1"],
    availabilityRules: [{ cleanerId: "cleaner-1", dayOfWeek: 1, startTime: "08:00", endTime: "18:00" }],
    exceptions: [],
    dayOverrides: [],
    existingAssignments: [],
    ...overrides,
  };
}

describe("computeAvailableStartTimes", () => {
  it("includes 08:00 as a valid start", () => {
    const result = computeAvailableStartTimes(baseQuery(), baseContext());
    expect(result.availableStartTimes).toContain("08:00");
  });

  it("includes 17:00 as a valid start (latest allowed START, not a completion cutoff)", () => {
    const result = computeAvailableStartTimes(baseQuery(), baseContext());
    expect(result.availableStartTimes).toContain("17:00");
  });

  it("never proposes a start before 08:00 or after 17:00", () => {
    const result = computeAvailableStartTimes(baseQuery(), baseContext());
    expect(result.availableStartTimes.every((t) => t >= "08:00" && t <= "17:00")).toBe(true);
  });

  it("allows a late job to run past the cleaner's declared window end (18:00) when it starts inside the window", () => {
    // Default context's cleaner window is 08:00-18:00. 17:00 start + 120
    // min service = ends 19:00, well past 18:00 — must still be offered,
    // since a cleaner's window bounds where a job may START, not where it
    // must end (mirrors CUSTOMER_WINDOW_LATEST_START's own "not a
    // completion cutoff" rule).
    const result = computeAvailableStartTimes(baseQuery({ serviceMinutes: 120 }), baseContext());
    expect(result.availableStartTimes).toContain("17:00");
  });

  it("returns no availability when a business-level full-day closure applies", () => {
    const context = baseContext({ dayOverrides: [{ type: "closed_all_day", blockStartTime: null, blockEndTime: null }] });
    const result = computeAvailableStartTimes(baseQuery(), context);
    expect(result.availableStartTimes).toEqual([]);
    expect(result.closedByOverride).toBe(true);
  });

  it("excludes candidate start times inside a partial-day block", () => {
    const context = baseContext({
      dayOverrides: [{ type: "partial_block", blockStartTime: "08:00", blockEndTime: "12:00" }],
    });
    const result = computeAvailableStartTimes(baseQuery(), context);
    expect(result.availableStartTimes).not.toContain("08:00");
    expect(result.availableStartTimes).not.toContain("11:30");
    expect(result.availableStartTimes).toContain("12:00");
  });

  it("excludes a cleaner with no recurring rule for that day of week", () => {
    const context = baseContext({
      availabilityRules: [{ cleanerId: "cleaner-1", dayOfWeek: 2 /* Tuesday, not Monday */, startTime: "08:00", endTime: "18:00" }],
    });
    const result = computeAvailableStartTimes(baseQuery(), context);
    expect(result.availableStartTimes).toEqual([]);
  });

  it("an unavailable_all_day exception overrides an otherwise-available recurring rule", () => {
    const context = baseContext({
      exceptions: [{ cleanerId: "cleaner-1", type: "unavailable_all_day", startTime: null, endTime: null }],
    });
    const result = computeAvailableStartTimes(baseQuery(), context);
    expect(result.availableStartTimes).toEqual([]);
  });

  it("a custom_hours exception replaces (not adds to) the recurring window", () => {
    const context = baseContext({
      exceptions: [{ cleanerId: "cleaner-1", type: "custom_hours", startTime: "12:00", endTime: "20:00" }],
    });
    const result = computeAvailableStartTimes(baseQuery(), context);
    expect(result.availableStartTimes).not.toContain("08:00");
    expect(result.availableStartTimes).toContain("12:00");
  });

  it("excludes a start time when fewer cleaners are free than required", () => {
    const context = baseContext({
      activeCleanerIds: ["cleaner-1", "cleaner-2"],
      availabilityRules: [
        { cleanerId: "cleaner-1", dayOfWeek: 1, startTime: "08:00", endTime: "18:00" },
        // cleaner-2 has no rule for Monday at all.
      ],
    });
    const result = computeAvailableStartTimes(baseQuery({ requiredCleanerCount: 2 }), context);
    expect(result.availableStartTimes).toEqual([]);
  });

  it("includes a start time once enough distinct cleaners are free (dynamic cleaner combinations)", () => {
    const context = baseContext({
      activeCleanerIds: ["cleaner-1", "cleaner-2", "cleaner-3"],
      availabilityRules: [
        { cleanerId: "cleaner-1", dayOfWeek: 1, startTime: "08:00", endTime: "12:00" },
        { cleanerId: "cleaner-2", dayOfWeek: 1, startTime: "08:00", endTime: "18:00" },
        { cleanerId: "cleaner-3", dayOfWeek: 1, startTime: "08:00", endTime: "18:00" },
      ],
    });
    // cleaner-1 can't take a 2-hour job starting at 11:00 (only free til
    // 12:00 -> ends 13:00), but cleaner-2 and cleaner-3 both can.
    const result = computeAvailableStartTimes(baseQuery({ requiredCleanerCount: 2, serviceMinutes: 120 }), context);
    expect(result.availableStartTimes).toContain("11:00");
  });

  it("a merely-requested (unconfirmed) visit contributes no existingAssignments, so it never blocks a new candidate", () => {
    // Simulates: caller only ever passes 'scheduled' assignments into
    // existingAssignments in the first place (per AvailabilityContext's own
    // contract) — an empty existingAssignments here represents a day with
    // only requested, not yet confirmed, visits.
    const context = baseContext({ existingAssignments: [] });
    const result = computeAvailableStartTimes(baseQuery(), context);
    expect(result.availableStartTimes).toContain("08:00");
  });

  it("a confirmed (scheduled) assignment blocks overlapping candidate times for that cleaner", () => {
    const context = baseContext({
      existingAssignments: [{ cleanerId: "cleaner-1", startTime: "08:00", endTime: "11:00" }],
    });
    const result = computeAvailableStartTimes(baseQuery({ serviceMinutes: 120 }), context);
    // 09:00 would overlap the existing [08:00,11:00) occupancy.
    expect(result.availableStartTimes).not.toContain("09:00");
  });

  it("enforces the 60-minute turnaround buffer between back-to-back jobs for the same cleaner", () => {
    // Existing job occupies (buffer-inclusive) [08:00, 11:00) i.e. a job
    // ending at 10:00 with a 60-minute buffer already baked into the stored
    // interval, matching how buffered_range is stored in Postgres.
    const context = baseContext({
      existingAssignments: [{ cleanerId: "cleaner-1", startTime: "08:00", endTime: "11:00" }],
    });
    const result = computeAvailableStartTimes(baseQuery({ serviceMinutes: 60, bufferMinutes: 60 }), context);
    // A new 60-min job starting at 11:00 occupies-with-buffer [11:00,12:00)
    // relative to its own buffer, which does not overlap [08:00,11:00) —
    // allowed.
    expect(result.availableStartTimes).toContain("11:00");
    // 10:30 would occupy-with-buffer [10:30, 11:30), overlapping the
    // existing [08:00, 11:00) — rejected.
    expect(result.availableStartTimes).not.toContain("10:30");
  });

  it("is deterministic — same query/context always produce the same result", () => {
    const context = baseContext();
    const query = baseQuery();
    expect(computeAvailableStartTimes(query, context)).toEqual(computeAvailableStartTimes(query, context));
  });
});

function baseCleanersQuery(overrides: Partial<AvailableCleanersQuery> = {}): AvailableCleanersQuery {
  return { date: DATE, startTime: "10:00", serviceMinutes: 120, bufferMinutes: 60, ...overrides };
}

describe("computeAvailableCleaners", () => {
  it("marks a cleaner available at a chosen start time within their window with no conflicts", () => {
    const result = computeAvailableCleaners(baseCleanersQuery(), baseContext());
    expect(result.cleaners).toEqual([{ cleanerId: "cleaner-1", available: true }]);
    expect(result.closedByOverride).toBe(false);
  });

  it("marks all cleaners unavailable on a business-level full-day closure", () => {
    const context = baseContext({ dayOverrides: [{ type: "closed_all_day", blockStartTime: null, blockEndTime: null }] });
    const result = computeAvailableCleaners(baseCleanersQuery(), context);
    expect(result.cleaners).toEqual([{ cleanerId: "cleaner-1", available: false }]);
    expect(result.closedByOverride).toBe(true);
  });

  it("marks cleaners unavailable when the chosen start falls inside a partial-day block", () => {
    const context = baseContext({ dayOverrides: [{ type: "partial_block", blockStartTime: "08:00", blockEndTime: "12:00" }] });
    const result = computeAvailableCleaners(baseCleanersQuery({ startTime: "10:00" }), context);
    expect(result.cleaners).toEqual([{ cleanerId: "cleaner-1", available: false }]);
  });

  it("marks a cleaner unavailable when they have no recurring rule for that day of week", () => {
    const context = baseContext({
      availabilityRules: [{ cleanerId: "cleaner-1", dayOfWeek: 2, startTime: "08:00", endTime: "18:00" }],
    });
    const result = computeAvailableCleaners(baseCleanersQuery(), context);
    expect(result.cleaners).toEqual([{ cleanerId: "cleaner-1", available: false }]);
  });

  it("marks a cleaner unavailable when an existing buffered assignment overlaps the chosen slot", () => {
    const context = baseContext({
      existingAssignments: [{ cleanerId: "cleaner-1", startTime: "09:00", endTime: "11:00" }],
    });
    const result = computeAvailableCleaners(baseCleanersQuery({ startTime: "10:00" }), context);
    expect(result.cleaners).toEqual([{ cleanerId: "cleaner-1", available: false }]);
  });

  it("returns one entry per active cleaner, correctly distinguishing available from unavailable", () => {
    const context = baseContext({
      activeCleanerIds: ["cleaner-1", "cleaner-2"],
      availabilityRules: [
        { cleanerId: "cleaner-1", dayOfWeek: 1, startTime: "08:00", endTime: "18:00" },
        // cleaner-2 has no rule for Monday at all.
      ],
    });
    const result = computeAvailableCleaners(baseCleanersQuery(), context);
    expect(result.cleaners).toEqual([
      { cleanerId: "cleaner-1", available: true },
      { cleanerId: "cleaner-2", available: false },
    ]);
  });

  it("an unavailable_all_day exception overrides an otherwise-available recurring rule", () => {
    const context = baseContext({
      exceptions: [{ cleanerId: "cleaner-1", type: "unavailable_all_day", startTime: null, endTime: null }],
    });
    const result = computeAvailableCleaners(baseCleanersQuery(), context);
    expect(result.cleaners).toEqual([{ cleanerId: "cleaner-1", available: false }]);
  });
});
