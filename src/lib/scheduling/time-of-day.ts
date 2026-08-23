import type { TimeOfDay } from "./types";

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Parses "HH:MM" (24-hour) into minutes since midnight. Throws on malformed input — every caller in this module works with already-validated config/DB values. */
export function timeToMinutes(time: TimeOfDay): number {
  const match = TIME_PATTERN.exec(time);
  if (!match) {
    throw new Error(`Invalid time-of-day "${time}" — expected HH:MM (24-hour).`);
  }
  return Number(match[1]) * 60 + Number(match[2]);
}

/** Formats minutes-since-midnight back to "HH:MM" (24-hour), zero-padded. Minutes may exceed 1439 (past midnight) — callers that need same-day-only semantics must check that themselves. */
export function minutesToTime(minutes: number): TimeOfDay {
  const normalized = ((minutes % 1440) + 1440) % 1440;
  const hours = Math.floor(normalized / 60);
  const mins = normalized % 60;
  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
}

/** Half-open minute interval [start, end) since midnight of some reference date. */
export interface MinuteInterval {
  start: number;
  end: number;
}

/** True when two half-open intervals [a.start, a.end) and [b.start, b.end) overlap. */
export function intervalsOverlap(a: MinuteInterval, b: MinuteInterval): boolean {
  return a.start < b.end && b.start < a.end;
}
