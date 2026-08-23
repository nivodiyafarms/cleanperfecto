import type {
  ActiveAssignmentIntervalRow,
  CleanerAvailabilityExceptionRow,
  CleanerAvailabilityRuleRow,
  CleanerRow,
  NewPackageAmendmentRow,
  NewPackageVisitPlanHistoryRow,
  NewPackageVisitPlanRow,
  NewRecurringScheduleRow,
  NewServiceFeeAssessmentRow,
  NewServiceVisitNotificationRow,
  NewServiceVisitRow,
  PackageAmendmentRow,
  PackageVisitPlanRow,
  PrepaidPackageRow,
  RecurringScheduleRow,
  SchedulingDayOverrideRow,
  ServiceFeeAssessmentRow,
  ServiceVisitEventRow,
  ServiceVisitRow,
} from "./domain-types";
import type { CalendarDate, PackageAmendmentApprovalState, PackageAmendmentPaymentState, PackageVisitPlanStatus } from "./types";

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
  insertServiceVisit(row: NewServiceVisitRow): Promise<ServiceVisitRow>;
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

  // -- events / fees / reminders ---------------------------------------
  insertServiceVisitEvent(row: ServiceVisitEventRow): Promise<void>;
  insertServiceFeeAssessment(row: NewServiceFeeAssessmentRow): Promise<ServiceFeeAssessmentRow>;
  insertServiceVisitNotification(row: NewServiceVisitNotificationRow): Promise<{ inserted: boolean }>;
  cancelPendingServiceVisitNotifications(serviceVisitId: string): Promise<void>;

  // -- recurring schedules -----------------------------------------------
  insertRecurringSchedule(row: NewRecurringScheduleRow): Promise<RecurringScheduleRow>;
  findRecurringScheduleById(id: string): Promise<RecurringScheduleRow | null>;
  findActiveRecurringScheduleForBookingOrder(bookingOrderId: string): Promise<RecurringScheduleRow | null>;
  findActiveRecurringScheduleForPackage(prepaidPackageId: string): Promise<RecurringScheduleRow | null>;
  supersedeRecurringSchedule(id: string, effectiveUntil: CalendarDate): Promise<void>;

  // -- prepaid packages / plans -------------------------------------------
  findPrepaidPackageById(id: string): Promise<PrepaidPackageRow | null>;
  listPackageVisitPlans(prepaidPackageId: string): Promise<PackageVisitPlanRow[]>;
  findPackageVisitPlanById(id: string): Promise<PackageVisitPlanRow | null>;
  insertPackageVisitPlan(row: NewPackageVisitPlanRow): Promise<{ plan: PackageVisitPlanRow; inserted: boolean }>;
  updatePackageVisitPlan(
    id: string,
    patch: { plannedDate?: CalendarDate; plannedStartTime?: string; status?: PackageVisitPlanStatus; serviceVisitId?: string }
  ): Promise<void>;
  insertPackageVisitPlanHistory(row: NewPackageVisitPlanHistoryRow): Promise<void>;

  // -- package amendments --------------------------------------------------
  insertPackageAmendment(row: NewPackageAmendmentRow): Promise<PackageAmendmentRow>;
  findPackageAmendmentById(id: string): Promise<PackageAmendmentRow | null>;
  updatePackageAmendmentState(
    id: string,
    patch: { approvalState?: PackageAmendmentApprovalState; paymentState?: PackageAmendmentPaymentState }
  ): Promise<PackageAmendmentRow | null>;
}
