import type { CalendarDate, TimeOfDay } from "./types";

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

function partsToUtcMillis(year: number, month: number, day: number, hour: number, minute: number): number {
  return Date.UTC(year, month - 1, day, hour, minute, 0, 0);
}

/** Reads the wall-clock date/time that a UTC instant maps to in `timeZone`, using the platform's built-in Intl/ICU data — no external date/timezone library is installed in this project. */
function zonedPartsOf(instant: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  // hour12:false can still render midnight as "24" under some ICU builds — normalize.
  const hour = get("hour") % 24;
  return { year: get("year"), month: get("month"), day: get("day"), hour, minute: get("minute") };
}

/**
 * Converts a local "YYYY-MM-DD" date + "HH:MM" wall-clock time in `timeZone`
 * to the corresponding UTC instant, via the standard guess-and-correct
 * technique against Intl.DateTimeFormat rather than assuming a fixed UTC
 * offset — so DST transitions in the business's timezone (America/Chicago)
 * are handled correctly year-round without adding a date/timezone library
 * dependency.
 */
export function zonedDateTimeToUtc(date: CalendarDate, time: TimeOfDay, timeZone: string): Date {
  const dateMatch = DATE_PATTERN.exec(date);
  if (!dateMatch) {
    throw new Error(`Invalid date "${date}" — expected YYYY-MM-DD.`);
  }
  const timeMatch = TIME_PATTERN.exec(time);
  if (!timeMatch) {
    throw new Error(`Invalid time "${time}" — expected HH:MM.`);
  }
  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  const targetMillis = partsToUtcMillis(year, month, day, hour, minute);

  // Initial guess: treat the wall time as if it were already UTC, then
  // correct by comparing what that guess actually reads as in the target
  // zone. Two correction passes comfortably cover a single DST transition.
  let guessMillis = targetMillis;
  for (let i = 0; i < 2; i++) {
    const zoned = zonedPartsOf(new Date(guessMillis), timeZone);
    const zonedMillis = partsToUtcMillis(zoned.year, zoned.month, zoned.day, zoned.hour, zoned.minute);
    const diff = targetMillis - zonedMillis;
    if (diff === 0) break;
    guessMillis += diff;
  }
  return new Date(guessMillis);
}

/** Converts a UTC instant to its local "YYYY-MM-DD" date and "HH:MM" time in `timeZone`. */
export function utcToZonedDateTime(instant: Date, timeZone: string): { date: CalendarDate; time: TimeOfDay } {
  const { year, month, day, hour, minute } = zonedPartsOf(instant, timeZone);
  const pad = (n: number) => String(n).padStart(2, "0");
  return { date: `${year}-${pad(month)}-${pad(day)}`, time: `${pad(hour)}:${pad(minute)}` };
}
