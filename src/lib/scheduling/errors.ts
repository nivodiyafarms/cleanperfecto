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
