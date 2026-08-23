import { computeAvailableStartTimes, type AvailabilityQuery, type AvailableStartTimesResult } from "./availability";
import { DEFAULT_TURNAROUND_BUFFER_MINUTES } from "./config";
import type { SchedulingRepository } from "./repository";
import { utcToZonedDateTime, zonedDateTimeToUtc } from "./timezone";
import type { CalendarDate } from "./types";

export interface FindAvailableStartTimesInput {
  date: CalendarDate;
  serviceMinutes: number;
  requiredCleanerCount: number;
  timezone: string;
  bufferMinutes?: number;
}

/**
 * Orchestrator that fetches everything computeAvailableStartTimes (the
 * pure engine — see availability.ts) needs from Supabase and assembles it
 * into that function's input shape, mirroring the separation between
 * calculateEstimate (pure) and its Supabase-backed callers elsewhere in
 * this codebase.
 *
 * KNOWN V1 LIMITATION: existing-assignment intervals are converted to
 * local HH:MM strings for the pure engine's timezone-naive frame. A job
 * whose buffered end crosses local midnight (extremely unlikely given the
 * 8 AM-5 PM start window and realistic job durations) would be
 * misinterpreted as ending earlier the same day rather than into the next
 * calendar date. Acceptable for V1; would need multi-day interval support
 * in the pure engine if very late, very long jobs become common.
 */
export async function findAvailableStartTimes(
  repo: SchedulingRepository,
  input: FindAvailableStartTimesInput
): Promise<AvailableStartTimesResult> {
  const [cleaners, availabilityRules, exceptions, dayOverrides] = await Promise.all([
    repo.listActiveCleaners(),
    repo.listActiveAvailabilityRules(),
    repo.listAvailabilityExceptionsForDate(input.date),
    repo.listDayOverridesForDate(input.date),
  ]);

  // Local midnight-to-midnight range for the requested date, in the
  // caller's timezone, converted to UTC bounds for the existing-
  // assignments query.
  const rangeStartUtc = zonedDateTimeToUtc(input.date, "00:00", input.timezone);
  const oneDayLaterUtc = new Date(rangeStartUtc.getTime() + 24 * 60 * 60 * 1000);
  const nextLocalDate = utcToZonedDateTime(oneDayLaterUtc, input.timezone).date;
  const rangeEndUtc = zonedDateTimeToUtc(nextLocalDate, "00:00", input.timezone);

  const activeAssignments = await repo.listActiveAssignmentsInRange(rangeStartUtc, rangeEndUtc);

  const existingAssignments = activeAssignments.map((a) => ({
    cleanerId: a.cleanerId,
    startTime: utcToZonedDateTime(a.confirmedStartAt, input.timezone).time,
    // Buffer already baked into endTime — matches the "already
    // buffer-inclusive" contract on ExistingAssignmentIntervalInput.
    endTime: utcToZonedDateTime(new Date(a.confirmedEndAt.getTime() + a.turnaroundBufferMinutes * 60_000), input.timezone).time,
  }));

  const query: AvailabilityQuery = {
    date: input.date,
    serviceMinutes: input.serviceMinutes,
    bufferMinutes: input.bufferMinutes ?? DEFAULT_TURNAROUND_BUFFER_MINUTES,
    requiredCleanerCount: input.requiredCleanerCount,
  };

  return computeAvailableStartTimes(query, {
    activeCleanerIds: cleaners.map((c) => c.id),
    availabilityRules: availabilityRules.map((r) => ({
      cleanerId: r.cleanerId,
      dayOfWeek: r.dayOfWeek,
      startTime: r.startTime,
      endTime: r.endTime,
    })),
    exceptions: exceptions.map((e) => ({ cleanerId: e.cleanerId, type: e.type, startTime: e.startTime, endTime: e.endTime })),
    dayOverrides: dayOverrides.map((o) => ({ type: o.type, blockStartTime: o.blockStartTime, blockEndTime: o.blockEndTime })),
    existingAssignments,
  });
}
