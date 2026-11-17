// Centralized source of truth for the first-cleaning promotional offer.
// No secrets, no I/O — safe to import from Server Components, Server
// Actions, Client Components, and tests alike. A future quote calculator
// and eligibility service should call `getActiveFirstCleaningOffer` rather
// than duplicating the percentages or deadline.

import type { CleaningType } from "@/lib/pricing/types";

export const LAUNCH_OFFER_PERCENT = 30;
export const STANDARD_OFFER_PERCENT = 25;
/** After OFFER_SWITCH_AT: 20% first-cleaning discount for Deep Cleaning only. */
export const DEEP_ONLY_OFFER_PERCENT = 20;
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

/**
 * December 1, 2026, 00:00:00.000 AM America/Chicago — the instant the standard
 * 25%-all-types offer switches to the new 20%-deep-only offer. Before this
 * instant, eligible customers see 25% off all cleaning types (standard, deep,
 * move) with a countdown to Nov 30. At/after this instant, only Deep Cleaning
 * gets 20% off, and Standard/Move-In-Out get no first-cleaning discount.
 */
export const OFFER_SWITCH_AT = zonedTimeToUtc(2026, 12, 1, 0, 0, 0, 0, OFFER_TIMEZONE);

export type FirstCleaningOfferType = "launch" | "standard" | "deep_only";

/** Which service types are eligible for the first-cleaning discount. */
export type EligibleServices = "all" | "deep_only";

export interface ActiveFirstCleaningOffer {
  percent: number;
  offerType: FirstCleaningOfferType;
  isLaunchActive: boolean;
  showCountdown: boolean;
  /** ISO instant the offer expires at, or null when the offer has no scheduled end. */
  expiresAt: string | null;
  offerVersion: string;
  /**
   * Which cleaning types are eligible for the first-cleaning discount.
   * "all" = standard, deep, and move; "deep_only" = only deep cleaning.
   */
  eligibleServices: EligibleServices;
}

const LAUNCH_OFFER: ActiveFirstCleaningOffer = {
  percent: LAUNCH_OFFER_PERCENT,
  offerType: "launch",
  isLaunchActive: true,
  showCountdown: true,
  expiresAt: LAUNCH_OFFER_ENDS_AT.toISOString(),
  offerVersion: "first-cleaning-launch-2026-08",
  eligibleServices: "all",
};

const STANDARD_OFFER: ActiveFirstCleaningOffer = {
  percent: STANDARD_OFFER_PERCENT,
  offerType: "standard",
  isLaunchActive: false,
  showCountdown: true,
  expiresAt: OFFER_SWITCH_AT.toISOString(),
  offerVersion: "first-cleaning-standard-2026-09",
  eligibleServices: "all",
};

const DEEP_ONLY_OFFER: ActiveFirstCleaningOffer = {
  percent: DEEP_ONLY_OFFER_PERCENT,
  offerType: "deep_only",
  isLaunchActive: false,
  showCountdown: false,
  expiresAt: null,
  offerVersion: "first-cleaning-deep-only-2026-12",
  eligibleServices: "deep_only",
};

/** Determines the active first-cleaning offer for a given instant. Pure and deterministic — pass a frozen/mocked `now` in tests. */
export function getActiveFirstCleaningOffer(now: Date): ActiveFirstCleaningOffer {
  if (now.getTime() <= LAUNCH_OFFER_ENDS_AT.getTime()) {
    return LAUNCH_OFFER;
  }
  if (now.getTime() < OFFER_SWITCH_AT.getTime()) {
    return STANDARD_OFFER;
  }
  return DEEP_ONLY_OFFER;
}

/**
 * Determines whether the given cleaning type is eligible for the first-cleaning
 * offer at the specified instant. After OFFER_SWITCH_AT, only Deep Cleaning
 * qualifies; before that, all types (standard, deep, move) are eligible.
 */
export function isServiceEligibleForFirstCleaningOffer(
  now: Date,
  cleaningType: CleaningType
): boolean {
  const offer = getActiveFirstCleaningOffer(now);
  if (offer.eligibleServices === "all") {
    return true;
  }
  return cleaningType === "deep";
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

/**
 * Preview-only time override for testing the offer switch. Returns a Date
 * object to use as "now" for offer calculations. In production (or when no
 * override is requested), returns the real current time. In Vercel Preview
 * environments, accepts a `?offer_time_override` query parameter with an ISO
 * timestamp to simulate a specific instant.
 *
 * SECURITY: This is intentionally gated by VERCEL_ENV !== "production", so
 * it is impossible to use in production — the query parameter is completely
 * ignored. Even in Preview, this only affects offer display/pricing, never
 * stored data or payment amounts (those use server timestamps).
 *
 * Usage: `?offer_time_override=2026-12-01T06:00:00Z` to simulate post-cutoff.
 */
export function resolveOfferTime(overrideParam: string | null | undefined): Date {
  const isPreview =
    typeof process !== "undefined" &&
    process.env.VERCEL_ENV === "preview";

  if (!isPreview || !overrideParam) {
    return new Date();
  }

  const parsed = new Date(overrideParam);
  if (isNaN(parsed.getTime())) {
    console.warn(`[first-cleaning-offer] Invalid offer_time_override: ${overrideParam}, using real time`);
    return new Date();
  }

  console.info(`[first-cleaning-offer] PREVIEW TIME OVERRIDE: ${parsed.toISOString()}`);
  return parsed;
}
