import { CUSTOMER_WINDOW_LATEST_START, CUSTOMER_WINDOW_START, DEFAULT_CANDIDATE_INTERVAL_MINUTES } from "./config";
import { dayOfWeekForDate } from "./recurrence-dates";
import { intervalsOverlap, minutesToTime, timeToMinutes, type MinuteInterval } from "./time-of-day";
import type { CalendarDate, TimeOfDay } from "./types";

export interface CleanerAvailabilityRuleInput {
  cleanerId: string;
  dayOfWeek: number;
  startTime: TimeOfDay;
  endTime: TimeOfDay;
}

export interface CleanerAvailabilityExceptionInput {
  cleanerId: string;
  type: "unavailable_all_day" | "custom_hours";
  startTime: TimeOfDay | null;
  endTime: TimeOfDay | null;
}

export interface SchedulingDayOverrideInput {
  type: "closed_all_day" | "partial_block";
  blockStartTime: TimeOfDay | null;
  blockEndTime: TimeOfDay | null;
}

export interface ExistingAssignmentIntervalInput {
  cleanerId: string;
  /** Buffer-inclusive interval for the requested date, in the same local time-of-day frame as availability rules — i.e. [confirmed_start, confirmed_end + turnaround_buffer) already expressed as HH:MM bounds for that date. */
  startTime: TimeOfDay;
  endTime: TimeOfDay;
}

/**
 * Everything the pure engine needs, already fetched and scoped to the
 * requested date — see src/lib/scheduling/repository.ts for the orchestrator
 * that assembles this from Supabase. Kept as plain data so this function
 * stays unit-testable with zero DB, mirroring calculateEstimate's purity.
 */
export interface AvailabilityContext {
  activeCleanerIds: string[];
  /** Every recurring rule for every active cleaner (any day of week) — filtered internally to the requested date's day of week. */
  availabilityRules: CleanerAvailabilityRuleInput[];
  /** Exceptions for the requested date only (any cleaner without one here uses their recurring rule instead). */
  exceptions: CleanerAvailabilityExceptionInput[];
  /** Business-level overrides for the requested date only. */
  dayOverrides: SchedulingDayOverrideInput[];
  /** Existing active (unassigned_at IS NULL) assignments for the requested date only — a merely-requested (unconfirmed) visit contributes none of these, by construction (see service_visit_assignments' table comment). */
  existingAssignments: ExistingAssignmentIntervalInput[];
}

export interface AvailabilityQuery {
  date: CalendarDate;
  /** The calendar time the appointment would block, from duration-engine.ts. */
  serviceMinutes: number;
  /** Turnaround buffer to apply against each candidate cleaner's other jobs that day — normally DEFAULT_TURNAROUND_BUFFER_MINUTES. */
  bufferMinutes: number;
  requiredCleanerCount: number;
  windowStart?: TimeOfDay;
  windowLatestStart?: TimeOfDay;
  /** Candidate-start-time granularity; defaults to DEFAULT_CANDIDATE_INTERVAL_MINUTES. */
  candidateIntervalMinutes?: number;
}

export interface AvailableStartTimesResult {
  date: CalendarDate;
  /** Sorted "HH:MM" start times that can actually support the requested job. Empty means no capacity — "full" is always this dynamic, computed outcome, never a stored flag. */
  availableStartTimes: TimeOfDay[];
  /** True when a business-level closed_all_day override applies to this date — availableStartTimes is always [] in that case, but this distinguishes "admin closed the day" from "cleaners happen to be full" for a caller that wants to explain why. */
  closedByOverride: boolean;
}

function cleanerWindowsForDate(
  cleanerId: string,
  dayOfWeek: number,
  context: AvailabilityContext
): MinuteInterval[] {
  const exception = context.exceptions.find((e) => e.cleanerId === cleanerId);
  if (exception) {
    if (exception.type === "unavailable_all_day") {
      return [];
    }
    // custom_hours REPLACES the recurring rule(s) for this date entirely,
    // never combines with them.
    return exception.startTime && exception.endTime
      ? [{ start: timeToMinutes(exception.startTime), end: timeToMinutes(exception.endTime) }]
      : [];
  }

  return context.availabilityRules
    .filter((rule) => rule.cleanerId === cleanerId && rule.dayOfWeek === dayOfWeek)
    .map((rule) => ({ start: timeToMinutes(rule.startTime), end: timeToMinutes(rule.endTime) }));
}

/**
 * A cleaner's window bounds where a job may START, not where it must end —
 * same "latest START, not a completion cutoff" rule as
 * CUSTOMER_WINDOW_LATEST_START, applied per cleaner. A job starting inside
 * the window may run past window.end if that's operationally approved
 * (e.g. a job starting near the end of an 08:00-18:00 window is allowed to
 * finish after 18:00) — see the spec's explicit "do not treat 6 PM as a
 * hard required completion cutoff" rule.
 */
function startsWithinAnyWindow(startMinutes: number, windows: MinuteInterval[]): boolean {
  return windows.some((window) => startMinutes >= window.start && startMinutes < window.end);
}

/**
 * Whether a given cleaner can take a job occupying [candidateStart,
 * candidateStart + serviceMinutes) on the requested date: the job must
 * START inside one of the cleaner's available windows for that date (see
 * startsWithinAnyWindow), and the buffer-inclusive occupancy
 * [candidateStart, candidateStart + serviceMinutes + bufferMinutes) must
 * not overlap any of that cleaner's existing buffered assignment
 * intervals. The buffer is deliberately NOT checked against the
 * availability window itself — it only has to fit before whatever the
 * cleaner's NEXT job (if any) would be, not within today's declared hours.
 */
function cleanerIsFreeFor(
  cleanerId: string,
  jobInterval: MinuteInterval,
  bufferMinutes: number,
  windows: MinuteInterval[],
  context: AvailabilityContext
): boolean {
  if (!startsWithinAnyWindow(jobInterval.start, windows)) {
    return false;
  }

  const occupancyWithBuffer: MinuteInterval = { start: jobInterval.start, end: jobInterval.end + bufferMinutes };

  return !context.existingAssignments
    .filter((a) => a.cleanerId === cleanerId)
    .some((a) =>
      intervalsOverlap(occupancyWithBuffer, { start: timeToMinutes(a.startTime), end: timeToMinutes(a.endTime) })
    );
}

/**
 * Dynamically computes which start times, on the requested date, can
 * actually support the job — never a stored slot inventory. Considers (in
 * order): a business-level full-day closure short-circuits to no
 * availability; partial-day blocks remove candidate start times that fall
 * inside them; each active cleaner's recurring availability, overridden
 * cleanly by any date-specific exception; existing CONFIRMED (buffer-
 * inclusive) assignments for that date, which a merely-requested visit
 * never contributes (see AvailabilityContext.existingAssignments); the
 * required cleaner count; the tentative service duration; and the
 * turnaround buffer. A 5:00 PM candidate start is allowed to produce a job
 * ending well past 6:00 PM — only the START time is window-bounded.
 */
export function computeAvailableStartTimes(query: AvailabilityQuery, context: AvailabilityContext): AvailableStartTimesResult {
  const windowStart = query.windowStart ?? CUSTOMER_WINDOW_START;
  const windowLatestStart = query.windowLatestStart ?? CUSTOMER_WINDOW_LATEST_START;
  const candidateIntervalMinutes = query.candidateIntervalMinutes ?? DEFAULT_CANDIDATE_INTERVAL_MINUTES;

  if (context.dayOverrides.some((o) => o.type === "closed_all_day")) {
    return { date: query.date, availableStartTimes: [], closedByOverride: true };
  }

  const blockedStartRanges: MinuteInterval[] = context.dayOverrides
    .filter((o) => o.type === "partial_block" && o.blockStartTime && o.blockEndTime)
    .map((o) => ({ start: timeToMinutes(o.blockStartTime as string), end: timeToMinutes(o.blockEndTime as string) }));

  const dayOfWeek = dayOfWeekForDate(query.date);
  const activeCleanerIds = context.activeCleanerIds;

  const windowStartMinutes = timeToMinutes(windowStart);
  const windowLatestStartMinutes = timeToMinutes(windowLatestStart);

  const availableStartTimes: TimeOfDay[] = [];

  for (
    let candidateStart = windowStartMinutes;
    candidateStart <= windowLatestStartMinutes;
    candidateStart += candidateIntervalMinutes
  ) {
    if (blockedStartRanges.some((blocked) => candidateStart >= blocked.start && candidateStart < blocked.end)) {
      continue;
    }

    const jobInterval: MinuteInterval = { start: candidateStart, end: candidateStart + query.serviceMinutes };

    const freeCleanerCount = activeCleanerIds.filter((cleanerId) => {
      const windows = cleanerWindowsForDate(cleanerId, dayOfWeek, context);
      if (windows.length === 0) {
        return false;
      }
      return cleanerIsFreeFor(cleanerId, jobInterval, query.bufferMinutes, windows, context);
    }).length;

    if (freeCleanerCount >= query.requiredCleanerCount) {
      availableStartTimes.push(minutesToTime(candidateStart));
    }
  }

  return { date: query.date, availableStartTimes, closedByOverride: false };
}
