// Pure types for the CleanPerfecto scheduling engine. No React, no Supabase,
// no network — mirrors src/lib/pricing/types.ts's own separation between
// pure types and the orchestrators that consume them.

export type ServiceVisitStatus = "requested" | "scheduled" | "completed" | "cancelled";

export type RecurringCadence = "weekly" | "biweekly" | "every_4_weeks";

export type RecurringScheduleStatus = "active" | "paused" | "superseded" | "cancelled";

export type PackageVisitPlanStatus = "planned" | "linked";

export type FeeType = "reschedule" | "cancellation" | "no_access";

export type FeeAssessmentState = "assessed" | "waived" | "paid" | "void";

export type PackageAmendmentApprovalState = "pending_customer_approval" | "approved" | "rejected";

export type PackageAmendmentPaymentState =
  | "not_required"
  | "additional_payment_pending"
  | "additional_payment_completed"
  | "refund_pending"
  | "refund_completed"
  | "credit_issued";

/**
 * "HH:MM", 24-hour, minute precision — the same time-of-day representation
 * used by the underlying Postgres `time` columns (cleaner_availability_rules,
 * cleaner_availability_exceptions, scheduling_day_overrides). The pure
 * availability/duration engines operate entirely in this timezone-naive
 * local-time-of-day frame; converting to/from an actual timestamptz (using a
 * visit's timezone) is the orchestration layer's job, not the pure engine's.
 */
export type TimeOfDay = string;

/** "YYYY-MM-DD" calendar date, timezone-independent (see recurrence-dates.ts). */
export type CalendarDate = string;
