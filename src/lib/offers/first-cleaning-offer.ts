// Centralized source of truth for the first-cleaning promotional offer.
// No secrets, no I/O — safe to import from Server Components, Server
// Actions, Client Components, and tests alike. A future quote calculator
// and eligibility service should call `getActiveFirstCleaningOffer` rather
// than duplicating the percentages or deadline.

export const LAUNCH_OFFER_PERCENT = 30;
export const STANDARD_OFFER_PERCENT = 25;
export const OFFER_TIMEZONE = "America/Chicago";

function getTimeZoneOffsetMs(utcDate: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(utcDate);

  const lookup: Record<string, number> = {};
  for (const part of parts) {
    if (part.type !== "literal") {
      lookup[part.type] = Number(part.value);
    }
  }

  const asUtc = Date.UTC(
    lookup.year,
    lookup.month - 1,
    lookup.day,
    lookup.hour === 24 ? 0 : lookup.hour,
    lookup.minute,
    lookup.second
  );

  return asUtc - utcDate.getTime();
}

// Converts a wall-clock date/time in `timeZone` to the UTC instant it
// represents. Iterates twice because the correct offset can itself depend
// on which side of a DST transition the resulting instant falls on.
// Milliseconds are deliberately excluded from the offset iteration (the
// Intl formatter used inside getTimeZoneOffsetMs is second-granularity, so
// feeding it a sub-second guess would silently truncate and skew the
// result by up to ~1s) and added back once the whole-second instant has
// converged, since no real IANA zone changes offset within a second.
function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  millisecond: number,
  timeZone: string
): Date {
  let utcGuess = Date.UTC(year, month - 1, day, hour, minute, second);
  for (let i = 0; i < 2; i++) {
    const offset = getTimeZoneOffsetMs(new Date(utcGuess), timeZone);
    utcGuess = Date.UTC(year, month - 1, day, hour, minute, second) - offset;
  }
  return new Date(utcGuess + millisecond);
}

/** August 31, 2026, 11:59:59.999 PM America/Chicago — inclusive end of the launch offer. */
export const LAUNCH_OFFER_ENDS_AT = zonedTimeToUtc(2026, 8, 31, 23, 59, 59, 999, OFFER_TIMEZONE);

export type FirstCleaningOfferType = "launch" | "standard";

export interface ActiveFirstCleaningOffer {
  percent: number;
  offerType: FirstCleaningOfferType;
  isLaunchActive: boolean;
  showCountdown: boolean;
  /** ISO instant the offer expires at, or null when the offer has no scheduled end. */
  expiresAt: string | null;
  offerVersion: string;
}

const LAUNCH_OFFER: ActiveFirstCleaningOffer = {
  percent: LAUNCH_OFFER_PERCENT,
  offerType: "launch",
  isLaunchActive: true,
  showCountdown: true,
  expiresAt: LAUNCH_OFFER_ENDS_AT.toISOString(),
  offerVersion: "first-cleaning-launch-2026-08",
};

const STANDARD_OFFER: ActiveFirstCleaningOffer = {
  percent: STANDARD_OFFER_PERCENT,
  offerType: "standard",
  isLaunchActive: false,
  showCountdown: false,
  expiresAt: null,
  offerVersion: "first-cleaning-standard-2026-09",
};

/** Determines the active first-cleaning offer for a given instant. Pure and deterministic — pass a frozen/mocked `now` in tests. */
export function getActiveFirstCleaningOffer(now: Date): ActiveFirstCleaningOffer {
  return now.getTime() <= LAUNCH_OFFER_ENDS_AT.getTime() ? LAUNCH_OFFER : STANDARD_OFFER;
}

export interface CountdownParts {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
}

/** Whole days/hours/minutes/seconds remaining until `expiresAt`, floored at zero. */
export function getCountdownParts(now: Date, expiresAt: string): CountdownParts {
  const remainingMs = Math.max(0, new Date(expiresAt).getTime() - now.getTime());
  const totalSeconds = Math.floor(remainingMs / 1000);
  return {
    days: Math.floor(totalSeconds / 86400),
    hours: Math.floor((totalSeconds % 86400) / 3600),
    minutes: Math.floor((totalSeconds % 3600) / 60),
    seconds: totalSeconds % 60,
  };
}

export function formatCountdown(parts: CountdownParts): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${parts.days}d ${pad(parts.hours)}h ${pad(parts.minutes)}m ${pad(parts.seconds)}s remaining`;
}
