import type { CleaningType, SizeTier } from "@/lib/pricing/types";

/**
 * Earliest customer-requestable appointment START time (V1, owner-approved
 * 2026-08-22).
 */
export const CUSTOMER_WINDOW_START = "08:00";

/**
 * Latest customer-requestable appointment START time (V1, owner-approved
 * 2026-08-22) — NOT a completion cutoff. A 5:00 PM start may run past
 * 6:00 PM if operationally approved; this only bounds where an appointment
 * may BEGIN, never where it must end.
 *
 * Distinct from the older, deliberately untouched
 * OPERATING_HOURS_START/OPERATING_HOURS_END in
 * src/lib/booking/operating-hours.ts, which gates the existing booking-page
 * time picker's 08:00-18:00 display window — that file's own comment
 * already anticipates being superseded by "a future milestone" (this one).
 * The two are intentionally not unified here: a customer can currently
 * request a time up to 17:59 on the booking page, but this engine can never
 * confirm a start after 17:00. That gap is documented and deliberately
 * deferred (narrowing the picker itself is future UI work), not a bug —
 * create-requested-visit-from-booking.ts passes the raw requested time
 * through unmodified; a >17:00 request simply surfaces as "no availability"
 * when confirmation is attempted, a normal outcome, not a data error.
 */
export const CUSTOMER_WINDOW_LATEST_START = "17:00";

/**
 * Minutes reserved between the end of one job and the start of the next for
 * the SAME cleaner — a single gap, not buffered on both sides of every job
 * (see service_visit_assignments.buffered_range in
 * 20260822090500_enable_btree_gist_and_create_service_visit_assignments.sql
 * for the exact one-sided range math this constant feeds). Owner-approved
 * V1 value; expected to drop to ~30 minutes as staffing grows. A single
 * named constant so nothing hardcodes 60 inline. Future agentic scheduling
 * may replace this fixed buffer with a real travel-time calculation without
 * a schema change — each visit freezes its own turnaround_buffer_minutes at
 * confirmation time, so changing this default never rewrites history. This
 * is a scheduling-buffer concept, distinct from the ZIP travel-distance
 * bands used for pricing (src/lib/pricing/zip-travel.ts) — those represent
 * distance FROM CleanPerfecto's base ZIP for pricing purposes, not real
 * point-to-point travel time between two consecutive jobs.
 */
export const DEFAULT_TURNAROUND_BUFFER_MINUTES = 60;

/** Rounds estimatedServiceMinutes up to the nearest multiple of this many minutes, for calendar-friendly slot boundaries. */
export const SERVICE_MINUTES_ROUNDING_INCREMENT = 15;

/** Default candidate-start-time granularity for computeAvailableStartTimes. */
export const DEFAULT_CANDIDATE_INTERVAL_MINUTES = 30;

/**
 * ----------------------------------------------------------------------
 * TENTATIVE V1 DURATION DEFAULTS — NOT OWNER-APPROVED BUSINESS FACTS.
 * ----------------------------------------------------------------------
 * These are conservative, structurally-reasonable placeholders so the
 * scheduling engine has something to compute against. They need real
 * operational tuning from actual job timings before being treated as
 * accurate — report them as assumptions requiring business sign-off, the
 * same way pricing numbers were flagged before being owner-approved. Do
 * not treat these as final without that sign-off.
 * ----------------------------------------------------------------------
 */

/**
 * Base labor-minutes (total person-minutes of work, before room/condition
 * adjustments) by cleaning type x size tier. Move duplicates Deep's numbers
 * per tier — Move-In/Move-Out already reuses Deep's room-adjustment RATES
 * in the pricing engine (see src/lib/pricing/room-adjustments.ts); the same
 * reuse is applied here for duration rather than inventing a third table.
 */
export const BASE_LABOR_MINUTES: Record<CleaningType, Record<SizeTier, number>> = {
  standard: {
    studio_1ba: 90,
    "1br_1ba": 120,
    "2br_2ba": 150,
    "3br_2ba": 195,
    "4br_plus": 240,
  },
  deep: {
    studio_1ba: 150,
    "1br_1ba": 195,
    "2br_2ba": 240,
    "3br_2ba": 300,
    "4br_plus": 360,
  },
  move: {
    studio_1ba: 150,
    "1br_1ba": 195,
    "2br_2ba": 240,
    "3br_2ba": 300,
    "4br_plus": 360,
  },
};

/**
 * Additional labor-minutes per extra bedroom/full/half bathroom above the
 * size tier's baseline (see SIZE_TIER_BASELINE_ROOMS in
 * src/lib/pricing/config.ts) — applied before the condition multiplier.
 * Same structure as ROOM_ADJUSTMENT_CONFIG in pricing/room-adjustments.ts
 * but in minutes rather than dollars. Uses one flat rate per room type
 * across every cleaning type in V1 (unlike pricing's per-type dollar
 * rates) — a simplifying placeholder, not a confirmed business rule.
 */
export const DURATION_ROOM_ADJUSTMENT_MINUTES = {
  additionalBedroom: 15,
  additionalFullBathroom: 20,
  additionalHalfBathroom: 10,
};

/**
 * Recommended cleaner count by size tier — V1 placeholder. An admin can
 * override the actual assigned cleaner count per visit when confirming;
 * this only seeds the initial recommendation and the labor-to-calendar-time
 * conversion.
 */
export const RECOMMENDED_CLEANER_COUNT: Record<SizeTier, number> = {
  studio_1ba: 1,
  "1br_1ba": 1,
  "2br_2ba": 1,
  "3br_2ba": 2,
  "4br_plus": 2,
};
