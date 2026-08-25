import type {
  ActiveAssignmentIntervalRow,
  CleanerAvailabilityExceptionRow,
  CleanerAvailabilityRuleRow,
  CleanerRow,
  NewPackageAmendmentRow,
  NewPackageVisitPlanHistoryRow,
  NewPackageVisitPlanRow,
  NewRecurringScheduleRow,
  NewRecurringScopeVersionRow,
  NewRecurringVisitPlanHistoryRow,
  NewRecurringVisitPlanRow,
  NewServiceFeeAssessmentRow,
  NewServiceVisitNotificationRow,
  NewServiceVisitPricingRow,
  NewServiceVisitRow,
  PackageAmendmentRow,
  PackageVisitPlanRow,
  PrepaidPackageRow,
  RecurringScheduleRow,
  RecurringScopeVersionRow,
  RecurringVisitPlanRow,
  SchedulingDayOverrideRow,
  ServiceFeeAssessmentRow,
  ServiceVisitEventRow,
  ServiceVisitNotificationRow,
  ServiceVisitPricingRow,
  ServiceVisitRow,
} from "./domain-types";
import type {
  CalendarDate,
  FeeAssessmentState,
  PackageAmendmentApprovalState,
  PackageAmendmentPaymentState,
  PackageVisitPlanStatus,
  RecurringScopeVersionStatus,
  RecurringVisitPlanStatus,
  ServiceVisitPricingPaymentStatus,
} from "./types";

/**
 * Everything the scheduling module needs from persistence, combined into
 * one interface — same shape/intent as BookingRepository in
 * src/lib/booking/repository.ts. See supabase-scheduling-repository.ts for
 * the production implementation and test-support/fake-scheduling-repository.ts
 * for the in-memory test double.
 */
export interface SchedulingRepository {
  // -- cleaners / availability -------------------------------------------
  listActiveCleaners(): Promise<CleanerRow[]>;
  listActiveAvailabilityRules(): Promise<CleanerAvailabilityRuleRow[]>;
  listAvailabilityExceptionsForDate(date: CalendarDate): Promise<CleanerAvailabilityExceptionRow[]>;
  listDayOverridesForDate(date: CalendarDate): Promise<SchedulingDayOverrideRow[]>;
  /** Active (unassigned_at IS NULL) assignments whose confirmed_start_at falls within [rangeStartUtc, rangeEndUtc). */
  listActiveAssignmentsInRange(rangeStartUtc: Date, rangeEndUtc: Date): Promise<ActiveAssignmentIntervalRow[]>;

  // -- service_visits -------------------------------------------------------
  findServiceVisitById(id: string): Promise<ServiceVisitRow | null>;
  /** The one directly-created visit for a booking order (recurring_schedule_id IS NULL), if any — used by create-requested-visit-from-booking's idempotency check. */
  findDirectServiceVisitByBookingOrderId(bookingOrderId: string): Promise<ServiceVisitRow | null>;
  /** Every service_visits row for a customer (any status), newest first — used by the customer portal's history/profile-address-fallback views. */
  listServiceVisitsForCustomer(customerId: string): Promise<ServiceVisitRow[]>;
  insertServiceVisit(row: NewServiceVisitRow): Promise<ServiceVisitRow>;
  /** Updates ONLY requested_start_at — never confirmed_start_at/confirmed_end_at/status/assignments. Used by a customer's self-service reschedule REQUEST against an already-'scheduled' visit, which must never silently overwrite the confirmed operational schedule (see request-visit-reschedule.ts). */
  updateServiceVisitRequestedStart(serviceVisitId: string, requestedStartAt: Date): Promise<void>;
  /** Atomic confirm/reschedule/reassign via the set_service_visit_schedule() Postgres function. Throws a SchedulingConflictError (see errors.ts) on an exclusion_violation (23P01). */
  setServiceVisitSchedule(params: {
    serviceVisitId: string;
    confirmedStartAt: Date;
    confirmedEndAt: Date;
    estimatedLaborMinutes: number;
    estimatedServiceMinutes: number;
    recommendedCleanerCount: number;
    turnaroundBufferMinutes: number;
    cleanerIds: string[];
  }): Promise<void>;
  /** Atomic completion + package-credit consumption via the complete_service_visit() Postgres function. */
  completeServiceVisitRpc(serviceVisitId: string): Promise<void>;
  cancelServiceVisit(serviceVisitId: string): Promise<boolean>;
  /** Admin toggle — never set automatically. See enqueue-review-request.ts. */
  setReviewRequestSuppressed(serviceVisitId: string, suppressed: boolean): Promise<void>;

  // -- events / fees / reminders ---------------------------------------
  insertServiceVisitEvent(row: ServiceVisitEventRow): Promise<void>;
  insertServiceFeeAssessment(row: NewServiceFeeAssessmentRow): Promise<ServiceFeeAssessmentRow>;
  /** Workflow-state transition only (assessed -> waived/paid/void) — never touches amount/feeType/policyVersion, which stay a frozen record of what was actually assessed. reasonAppend, if given, is appended to the existing reason (e.g. why a fee was waived) rather than overwriting the original assessment reason. */
  updateServiceFeeAssessmentState(id: string, state: FeeAssessmentState, reasonAppend?: string): Promise<ServiceFeeAssessmentRow | null>;
  /** Insert-or-no-op via the unique idempotency_key — the one persistence seam every notification enqueue path goes through, see src/lib/notifications/enqueue-notification.ts. */
  insertServiceVisitNotification(row: NewServiceVisitNotificationRow): Promise<{ inserted: boolean }>;
  cancelPendingServiceVisitNotifications(serviceVisitId: string): Promise<void>;
  /** Every notification row for a visit, newest scheduled first — admin display only, never consumed by a domain workflow. */
  listServiceVisitNotifications(serviceVisitId: string): Promise<ServiceVisitNotificationRow[]>;
  findServiceVisitNotificationById(id: string): Promise<ServiceVisitNotificationRow | null>;
  /** Atomic claim via claim_due_service_visit_notifications() (see the migration) — claims due-pending rows AND stale-'sending' rows (a prior claim whose worker never finished) in one statement, FOR UPDATE SKIP LOCKED so concurrent dispatcher invocations never claim the same row twice. */
  claimDueServiceVisitNotifications(limit: number, staleMinutes: number): Promise<ServiceVisitNotificationRow[]>;
  markServiceVisitNotificationSent(id: string, providerMessageId: string | null): Promise<void>;
  /** A failed attempt that hasn't hit the retry cap: increments retry_count, records failure_reason, returns to 'pending' at a backed-off scheduled_send_at, clears claimed_at. Never silently converts an uncertain provider result into sent. */
  markServiceVisitNotificationRetry(id: string, params: { failureReason: string; nextScheduledSendAt: Date }): Promise<void>;
  markServiceVisitNotificationFailedTerminal(id: string, failureReason: string): Promise<void>;
  /** Admin manual retry: terminal 'failed' -> 'pending' with a fresh attempt budget (retry_count reset to 0) and scheduled_send_at = now(), eligible for the next dispatch tick. A no-op guard (state='failed' in the WHERE clause) — never touches a row that isn't actually terminal. */
  retryFailedServiceVisitNotification(id: string): Promise<void>;
  /** Cancels pending consent_reminder rows tied to ONE visit (its old confirmed time) — used by reschedule/cancel hooks, mirrors the existing reminder_24h cancel-by-visit pattern. */
  cancelPendingConsentReminderForVisit(serviceVisitId: string): Promise<void>;
  /** Cancels ALL of a customer's pending consent_reminder rows across every visit — used once the customer signs, since consent is customer-level and satisfies every outstanding reminder regardless of which visit prompted it. */
  cancelPendingConsentRemindersForCustomer(customerId: string): Promise<void>;
  /** Most recent sent_at among this customer's SENT review_request rows, or null if none — the 180-day cooldown check. Deliberately scoped to state='sent' only: a merely pending/queued or failed/cancelled attempt never started the cooldown (see enqueue-review-request.ts). */
  findMostRecentSentReviewRequestAt(customerId: string): Promise<Date | null>;

  // -- recurring schedules -----------------------------------------------
  insertRecurringSchedule(row: NewRecurringScheduleRow): Promise<RecurringScheduleRow>;
  findRecurringScheduleById(id: string): Promise<RecurringScheduleRow | null>;
  findActiveRecurringScheduleForBookingOrder(bookingOrderId: string): Promise<RecurringScheduleRow | null>;
  findActiveRecurringScheduleForPackage(prepaidPackageId: string): Promise<RecurringScheduleRow | null>;
  /** Every active recurring_schedules row for a customer (booking-order- and package-backed alike) — used to answer "does this customer have an active recurring relationship at all" (portal eligibility) and to drive the universal next-six calendar. */
  listActiveRecurringSchedulesForCustomer(customerId: string): Promise<RecurringScheduleRow[]>;
  supersedeRecurringSchedule(id: string, effectiveUntil: CalendarDate): Promise<void>;

  // -- prepaid packages / plans -------------------------------------------
  findPrepaidPackageById(id: string): Promise<PrepaidPackageRow | null>;
  /** The oldest active prepaid package still carrying credit for this customer (remaining_visit_count > 0), or null if none — resolved fresh at the moment a recurring_visit_plans row is turned into a real visit, never decided upfront by the schedule itself. Once every package is exhausted, this returns null and later visits become Pay Per Cleaning. */
  findActivePrepaidPackageForCustomer(customerId: string): Promise<PrepaidPackageRow | null>;
  listPackageVisitPlans(prepaidPackageId: string): Promise<PackageVisitPlanRow[]>;
  findPackageVisitPlanById(id: string): Promise<PackageVisitPlanRow | null>;
  /** The package_visit_plans row linked to a given universal recurring_visit_plans row, if any — the other half of the sync invariant (see sync-linked-recurring-package-plan.ts). */
  findPackageVisitPlanByRecurringVisitPlanId(recurringVisitPlanId: string): Promise<PackageVisitPlanRow | null>;
  insertPackageVisitPlan(row: NewPackageVisitPlanRow): Promise<{ plan: PackageVisitPlanRow; inserted: boolean }>;
  updatePackageVisitPlan(
    id: string,
    patch: {
      plannedDate?: CalendarDate;
      plannedStartTime?: string;
      status?: PackageVisitPlanStatus;
      serviceVisitId?: string;
      recurringVisitPlanId?: string;
    }
  ): Promise<void>;
  insertPackageVisitPlanHistory(row: NewPackageVisitPlanHistoryRow): Promise<void>;

  // -- package amendments --------------------------------------------------
  insertPackageAmendment(row: NewPackageAmendmentRow): Promise<PackageAmendmentRow>;
  findPackageAmendmentById(id: string): Promise<PackageAmendmentRow | null>;
  updatePackageAmendmentState(
    id: string,
    patch: { approvalState?: PackageAmendmentApprovalState; paymentState?: PackageAmendmentPaymentState }
  ): Promise<PackageAmendmentRow | null>;

  // -- recurring_visit_plans (universal calendar, Customer Portal V1) -----
  listRecurringVisitPlans(recurringScheduleId: string): Promise<RecurringVisitPlanRow[]>;
  findRecurringVisitPlanById(id: string): Promise<RecurringVisitPlanRow | null>;
  /** The recurring_visit_plans row linked to a given real service_visit, if any — needed because the FIRST (direct) visit of a normal booking always has service_visits.recurring_schedule_id = null by design (see service_visits_one_direct_visit_per_booking_order), even when its universal calendar slot #1 is linked to it. Callers that need "which schedule does this visit belong to, for replenishment purposes" must fall back to this when service_visits.recurringScheduleId is null. */
  findRecurringVisitPlanByServiceVisitId(serviceVisitId: string): Promise<RecurringVisitPlanRow | null>;
  insertRecurringVisitPlan(row: NewRecurringVisitPlanRow): Promise<{ plan: RecurringVisitPlanRow; inserted: boolean }>;
  updateRecurringVisitPlan(
    id: string,
    patch: {
      plannedDate?: CalendarDate;
      plannedStartTime?: string;
      status?: RecurringVisitPlanStatus;
      serviceVisitId?: string;
      /** Moves a still-'planned' row onto a new recurring_schedule_id version — used only by a cadence regeneration (replan-recurring-cadence.ts), never on an already-'linked' row. */
      recurringScheduleId?: string;
    }
  ): Promise<void>;
  insertRecurringVisitPlanHistory(row: NewRecurringVisitPlanHistoryRow): Promise<void>;

  // -- recurring_scope_versions (Customer Portal V1) -----------------------
  findActiveRecurringScopeVersion(recurringScheduleId: string): Promise<RecurringScopeVersionRow | null>;
  findRecurringScopeVersionById(id: string): Promise<RecurringScopeVersionRow | null>;
  insertRecurringScopeVersion(row: NewRecurringScopeVersionRow): Promise<RecurringScopeVersionRow>;
  supersedeRecurringScopeVersion(id: string): Promise<void>;
  updateRecurringScopeVersionStatus(id: string, status: RecurringScopeVersionStatus): Promise<RecurringScopeVersionRow | null>;

  // -- service_visit_pricing (Customer Portal V1) --------------------------
  findServiceVisitPricingByVisitId(serviceVisitId: string): Promise<ServiceVisitPricingRow | null>;
  /** Insert-or-overwrite the pricing/estimate fields for a visit (never touches paymentStatus/confirmedAt/confirmedBy). */
  upsertServiceVisitPricing(row: NewServiceVisitPricingRow): Promise<ServiceVisitPricingRow>;
  /** Admin confirms the current estimate as final: priceStatus -> 'confirmed', previouslyApprovedAmount -> totalAmount, paymentStatus -> 'awaiting_completion' if amountDueFromCustomer > 0 else left as 'not_applicable'. */
  confirmServiceVisitPricing(serviceVisitId: string, confirmedBy: string): Promise<ServiceVisitPricingRow | null>;
  updateServiceVisitPricingPaymentStatus(
    serviceVisitId: string,
    paymentStatus: ServiceVisitPricingPaymentStatus
  ): Promise<ServiceVisitPricingRow | null>;
}
