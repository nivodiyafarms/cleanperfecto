import { computeAvailableCleaners, type AvailableCleanersResult } from "./availability";
import { DEFAULT_TURNAROUND_BUFFER_MINUTES } from "./config";
import type { SchedulingRepository } from "./repository";
import { utcToZonedDateTime, zonedDateTimeToUtc } from "./timezone";
import type { CalendarDate, TimeOfDay } from "./types";

export interface FindAvailableCleanersInput {
  date: CalendarDate;
  startTime: TimeOfDay;
  serviceMinutes: number;
  timezone: string;
  bufferMinutes?: number;
  /** Pass the visit's own id when checking availability for a NEW candidate time on a visit that is ALREADY scheduled (reschedule) — otherwise that visit's own current booking is counted as a conflict against itself, making its assigned cleaner appear unavailable for every candidate time. Omit for a visit that isn't scheduled yet. */
  excludeServiceVisitId?: string;
}

/**
 * Orchestrator mirroring find-available-start-times.ts's own data-fetching
 * shape, but for the admin assignment UI's "which specific cleaners can
 * take THIS chosen slot" question — see computeAvailableCleaners in
 * availability.ts for the pure engine this wraps. Deliberately not folded
 * into find-available-start-times.ts itself: that function answers "which
 * start times work in aggregate," this one answers "which cleaners" for
 * one already-chosen time, a different question the UI needs separately.
 */
export async function findAvailableCleaners(
  repo: SchedulingRepository,
  input: FindAvailableCleanersInput
): Promise<AvailableCleanersResult> {
  const [cleaners, availabilityRules, exceptions, dayOverrides] = await Promise.all([
    repo.listActiveCleaners(),
    repo.listActiveAvailabilityRules(),
    repo.listAvailabilityExceptionsForDate(input.date),
    repo.listDayOverridesForDate(input.date),
  ]);

  const rangeStartUtc = zonedDateTimeToUtc(input.date, "00:00", input.timezone);
  const oneDayLaterUtc = new Date(rangeStartUtc.getTime() + 24 * 60 * 60 * 1000);
  const nextLocalDate = utcToZonedDateTime(oneDayLaterUtc, input.timezone).date;
  const rangeEndUtc = zonedDateTimeToUtc(nextLocalDate, "00:00", input.timezone);

  const activeAssignments = await repo.listActiveAssignmentsInRange(rangeStartUtc, rangeEndUtc, input.excludeServiceVisitId);

  const existingAssignments = activeAssignments.map((a) => ({
    cleanerId: a.cleanerId,
    startTime: utcToZonedDateTime(a.confirmedStartAt, input.timezone).time,
    endTime: utcToZonedDateTime(new Date(a.confirmedEndAt.getTime() + a.turnaroundBufferMinutes * 60_000), input.timezone).time,
  }));

  return computeAvailableCleaners(
    {
      date: input.date,
      startTime: input.startTime,
      serviceMinutes: input.serviceMinutes,
      bufferMinutes: input.bufferMinutes ?? DEFAULT_TURNAROUND_BUFFER_MINUTES,
    },
    {
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
    }
  );
}
