import { utcToZonedDateTime, zonedDateTimeToUtc } from "@/lib/scheduling/timezone";

/** Default delay after completion before a review request goes out — long enough to not feel robotic/immediate. */
const REVIEW_DELAY_HOURS = 3;
/** If the delayed send time lands at/after this local hour, it's deferred to the next local morning instead — never hardcoded to any specific timezone; always evaluated against the VISIT'S OWN timezone. */
const EVENING_CUTOFF_HOUR = 20; // 8:00 PM local
const NEXT_DAY_SEND_TIME = "10:00"; // ~10:00 AM local

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Same UTC-anchored calendar-day arithmetic convention as recurrence-dates.ts's addCadenceInterval — deliberately timezone-independent since this is pure calendar-day math, not a real instant. */
function addOneCalendarDay(date: string): string {
  const match = DATE_PATTERN.exec(date);
  if (!match) throw new Error(`Invalid date "${date}" — expected YYYY-MM-DD.`);
  const [, year, month, day] = match;
  const parsed = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  parsed.setUTCDate(parsed.getUTCDate() + 1);
  return parsed.toISOString().slice(0, 10);
}

/**
 * completed_at + 3 hours, evaluated in the VISIT'S OWN timezone (never a
 * hardcoded one — stays correct if CleanPerfecto ever serves a market
 * outside DFW, and stays compatible with a future SMS activation, which
 * cares just as much about not texting someone at 11pm). If that instant
 * falls at/after ~8:00 PM local, the request is deferred to ~10:00 AM the
 * following local day instead of arriving late at night.
 */
export function computeReviewRequestSendAt(completedAtUtc: Date, timezone: string): Date {
  const candidateUtc = new Date(completedAtUtc.getTime() + REVIEW_DELAY_HOURS * 60 * 60 * 1000);
  const { date, time } = utcToZonedDateTime(candidateUtc, timezone);
  const hour = Number(time.slice(0, 2));

  if (hour < EVENING_CUTOFF_HOUR) {
    return candidateUtc;
  }

  const nextDate = addOneCalendarDay(date);
  return zonedDateTimeToUtc(nextDate, NEXT_DAY_SEND_TIME, timezone);
}
