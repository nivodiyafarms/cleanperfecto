/**
 * Approved operating-hours window (owner-confirmed 2026-08-19) for the
 * "Preferred start time" picker on the booking page. This is a bound on
 * what can be *requested* — it is not a claim of guaranteed availability;
 * no scheduling/crew-availability engine exists yet (a future milestone).
 */
export const OPERATING_HOURS_START = "08:00";
export const OPERATING_HOURS_END = "18:00";

const START_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/** "HH:MM" (24-hour), within [OPERATING_HOURS_START, OPERATING_HOURS_END] inclusive. Zero-padded 24-hour strings compare correctly lexicographically. */
export function isWithinOperatingHours(startTime: string): boolean {
  return START_TIME_PATTERN.test(startTime) && startTime >= OPERATING_HOURS_START && startTime <= OPERATING_HOURS_END;
}
