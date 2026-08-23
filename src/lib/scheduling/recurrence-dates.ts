import type { CalendarDate, RecurringCadence } from "./types";

const CADENCE_DAYS: Record<RecurringCadence, number> = {
  weekly: 7,
  biweekly: 14,
  every_4_weeks: 28,
};

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Parses a "YYYY-MM-DD" date as a UTC-anchored calendar date — deliberately timezone-independent, since this module only does calendar-day arithmetic (never time-of-day), and anchoring to UTC avoids any DST-related day-boundary surprise. */
function parseDateOnly(date: CalendarDate): Date {
  const match = DATE_PATTERN.exec(date);
  if (!match) {
    throw new Error(`Invalid date "${date}" — expected YYYY-MM-DD.`);
  }
  const [, year, month, day] = match;
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
}

function formatDateOnly(date: Date): CalendarDate {
  return date.toISOString().slice(0, 10);
}

/** Day-of-week for a "YYYY-MM-DD" calendar date: 0=Sunday..6=Saturday, matching JS Date.getDay()/the day_of_week convention used by cleaner_availability_rules and recurring_schedules. */
export function dayOfWeekForDate(date: CalendarDate): number {
  return parseDateOnly(date).getUTCDay();
}

/**
 * Adds one cadence interval (7/14/28 calendar days) to a "YYYY-MM-DD" date.
 * Shared by generate-recurring-next-visit.ts (one date at a time, on-demand)
 * and plan-package-visit-dates.ts (all 6 up front) so the two never
 * duplicate the same date arithmetic — see the plan's validation note on
 * this exact risk.
 */
export function addCadenceInterval(date: CalendarDate, cadence: RecurringCadence): CalendarDate {
  const parsed = parseDateOnly(date);
  parsed.setUTCDate(parsed.getUTCDate() + CADENCE_DAYS[cadence]);
  return formatDateOnly(parsed);
}

/** Generates `count` dates starting from and including `firstDate`, each one cadence interval apart. */
export function generateCadenceDates(firstDate: CalendarDate, cadence: RecurringCadence, count: number): CalendarDate[] {
  if (count < 1) {
    return [];
  }
  const dates: CalendarDate[] = [firstDate];
  let current = firstDate;
  for (let i = 1; i < count; i++) {
    current = addCadenceInterval(current, cadence);
    dates.push(current);
  }
  return dates;
}
