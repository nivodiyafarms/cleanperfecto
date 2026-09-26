/**
 * Raised when set_service_visit_schedule() (or its in-memory test double)
 * rejects a confirm/reschedule/reassign attempt because it would overlap
 * another active assignment for the same cleaner — the domain-level
 * translation of a Postgres exclusion_violation (SQLSTATE 23P01) raised by
 * service_visit_assignments_no_overlap. Callers should present this as
 * "slot no longer available," never a generic failure.
 */
export class SchedulingConflictError extends Error {
  constructor(message = "This time slot is no longer available — please choose another.") {
    super(message);
    this.name = "SchedulingConflictError";
  }
}

/** Raised when an operation targets a service_visit that isn't in a state the operation supports (e.g. confirming an already-completed visit). */
export class InvalidVisitStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidVisitStateError";
  }
}

/**
 * Raised by refundPrepaidPackage() when a prepaid package's historical Tax
 * facts are unknown (taxAmount === null — a legacy package purchased before
 * tax accounting existed) rather than authoritatively zero (taxAmount ===
 * 0). Fail-closed: automated cancellation/refund must never guess, assume
 * $0, or recompute historical tax from today's rate — see
 * src/lib/payments/prepaid-package-tax-guard.ts. The message is owner-safe
 * (shown directly to admins) and never exposes internal implementation
 * details.
 */
export class LegacyPackageTaxUnknownError extends Error {
  constructor(
    message = "This legacy package does not contain complete historical tax information. Review the original Stripe transaction before issuing a refund."
  ) {
    super(message);
    this.name = "LegacyPackageTaxUnknownError";
  }
}
