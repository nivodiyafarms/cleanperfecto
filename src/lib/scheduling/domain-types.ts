import type { AddOnId, CalculationInput, CleaningType, FrequencyId } from "@/lib/pricing/types";
import type {
  CalendarDate,
  FeeAssessmentState,
  FeeType,
  PackageAmendmentApprovalState,
  PackageAmendmentPaymentState,
  PackageVisitPlanStatus,
  RecurringCadence,
  RecurringScheduleStatus,
  RecurringScopeVersionStatus,
  RecurringVisitPlanHistoryChangeReason,
  RecurringVisitPlanStatus,
  ServiceVisitNotificationChannel,
  ServiceVisitNotificationState,
  ServiceVisitNotificationType,
  ServiceVisitPricingPaymentStatus,
  ServiceVisitPricingPriceStatus,
  ServiceVisitStatus,
  TimeOfDay,
} from "./types";

export interface CleanerRow {
  id: string;
  name: string;
  active: boolean;
}

export interface CleanerAvailabilityRuleRow {
  id: string;
  cleanerId: string;
  dayOfWeek: number;
  startTime: TimeOfDay;
  endTime: TimeOfDay;
  active: boolean;
}

export interface CleanerAvailabilityExceptionRow {
  id: string;
  cleanerId: string;
  exceptionDate: CalendarDate;
  type: "unavailable_all_day" | "custom_hours";
  startTime: TimeOfDay | null;
  endTime: TimeOfDay | null;
}

export interface SchedulingDayOverrideRow {
  id: string;
  overrideDate: CalendarDate;
  type: "closed_all_day" | "partial_block";
  blockStartTime: TimeOfDay | null;
  blockEndTime: TimeOfDay | null;
}

/** An active (unassigned_at IS NULL) assignment, as needed by the availability engine — already resolved to a specific cleaner + confirmed UTC instants + the buffer in effect for that assignment. */
export interface ActiveAssignmentIntervalRow {
  cleanerId: string;
  confirmedStartAt: Date;
  confirmedEndAt: Date;
  turnaroundBufferMinutes: number;
}

export interface ServiceVisitRow {
  id: string;
  customerId: string;
  quoteRequestId: string | null;
  bookingOrderId: string | null;
  prepaidPackageId: string | null;
  recurringScheduleId: string | null;
  visitNumber: number | null;
  cleaningType: CleaningType | null;
  frequency: FrequencyId | null;
  status: ServiceVisitStatus;
  requestedStartAt: Date | null;
  confirmedAt: Date | null;
  confirmedStartAt: Date | null;
  confirmedEndAt: Date | null;
  estimatedLaborMinutes: number | null;
  estimatedServiceMinutes: number | null;
  recommendedCleanerCount: number | null;
  turnaroundBufferMinutes: number | null;
  timezone: string;
  completedAt: Date | null;
  cancelledAt: Date | null;
  serviceAddressLine1: string | null;
  serviceAddressLine2: string | null;
  serviceCity: string | null;
  serviceState: string | null;
  serviceAddressIdentity: string | null;
}

export interface NewServiceVisitRow {
  customerId: string;
  quoteRequestId: string | null;
  bookingOrderId: string | null;
  prepaidPackageId: string | null;
  recurringScheduleId: string | null;
  visitNumber: number | null;
  cleaningType: CleaningType | null;
  frequency: FrequencyId | null;
  requestedStartAt: Date | null;
  timezone: string;
  serviceAddressLine1: string | null;
  serviceAddressLine2: string | null;
  serviceCity: string | null;
  serviceState: string | null;
  serviceAddressIdentity: string | null;
}

export interface RecurringScheduleRow {
  id: string;
  customerId: string;
  bookingOrderId: string | null;
  prepaidPackageId: string | null;
  cadence: RecurringCadence;
  preferredDayOfWeek: number;
  preferredStartTime: TimeOfDay;
  timezone: string;
  status: RecurringScheduleStatus;
  effectiveFrom: CalendarDate;
  effectiveUntil: CalendarDate | null;
  supersedesId: string | null;
}

export interface NewRecurringScheduleRow {
  customerId: string;
  bookingOrderId: string | null;
  prepaidPackageId: string | null;
  cadence: RecurringCadence;
  preferredDayOfWeek: number;
  preferredStartTime: TimeOfDay;
  timezone: string;
  effectiveFrom: CalendarDate;
  supersedesId: string | null;
}

export interface PackageVisitPlanRow {
  id: string;
  prepaidPackageId: string;
  visitNumber: number;
  plannedDate: CalendarDate;
  plannedStartTime: TimeOfDay;
  status: PackageVisitPlanStatus;
  serviceVisitId: string | null;
  generatedFromRecurringScheduleId: string | null;
  /** Nullable, unique link to this visit's row in the universal recurring_visit_plans calendar — see sync-linked-recurring-package-plan.ts. Null for packages scheduled before this linkage existed. */
  recurringVisitPlanId: string | null;
}

export interface NewPackageVisitPlanRow {
  prepaidPackageId: string;
  visitNumber: number;
  plannedDate: CalendarDate;
  plannedStartTime: TimeOfDay;
  generatedFromRecurringScheduleId: string | null;
}

export interface PrepaidPackageRow {
  id: string;
  customerId: string;
  bookingOrderId: string;
  frequency: RecurringCadence;
  purchasedVisitCount: number;
  remainingVisitCount: number;
  /** The actual per-visit price charged at purchase (prepaid_packages.effective_price_per_visit) — a historical fact, used as the basis for a package amendment's "old value," never re-derived from the pricing engine (which could drift from what was actually paid if config changed since purchase). */
  effectivePricePerVisit: number;
  status: "active" | "completed" | "cancelled";
  /** Used to pick the oldest active package first when resolving which package a newly-scheduled recurring visit should draw a credit from (see findActivePrepaidPackageForCustomer / schedule-recurring-visit-plan.ts). */
  purchasedAt: Date;
}

export interface ServiceFeeAssessmentRow {
  id: string;
  serviceVisitId: string;
  feeType: FeeType;
  amount: number;
  policyVersion: string;
  reason: string | null;
  state: FeeAssessmentState;
}

export interface NewServiceFeeAssessmentRow {
  serviceVisitId: string;
  feeType: FeeType;
  amount: number;
  policyVersion: string;
  reason: string | null;
}

export interface ServiceVisitEventRow {
  serviceVisitId: string;
  eventType:
    | "requested"
    | "confirmed"
    | "rescheduled"
    | "reschedule_requested"
    | "cleaner_assigned"
    | "cleaner_reassigned"
    | "cleaner_unassigned"
    | "cancelled"
    | "completed"
    | "no_access_recorded";
  actor: string | null;
  previousState: Record<string, unknown> | null;
  newState: Record<string, unknown> | null;
  notes: string | null;
}

export interface PackageAmendmentRow {
  id: string;
  prepaidPackageId: string;
  oldCadence: RecurringCadence;
  newCadence: RecurringCadence;
  effectiveFromVisitNumber: number;
  remainingVisitCountAtAmendment: number;
  oldRemainingValue: number;
  newRemainingValue: number;
  valueDifference: number;
  pricingSnapshot: unknown;
  newRecurringScheduleId: string | null;
  reason: string | null;
  approvalState: PackageAmendmentApprovalState;
  paymentState: PackageAmendmentPaymentState;
  initiatedByNote: string | null;
}

export interface NewPackageAmendmentRow {
  prepaidPackageId: string;
  oldCadence: RecurringCadence;
  newCadence: RecurringCadence;
  effectiveFromVisitNumber: number;
  remainingVisitCountAtAmendment: number;
  oldRemainingValue: number;
  newRemainingValue: number;
  valueDifference: number;
  pricingSnapshot: unknown;
  reason: string | null;
  initiatedByNote: string | null;
}

export interface NewPackageVisitPlanHistoryRow {
  packageVisitPlanId: string;
  prepaidPackageId: string;
  visitNumber: number;
  previousPlannedDate: CalendarDate | null;
  previousPlannedStartTime: TimeOfDay | null;
  previousStatus: PackageVisitPlanStatus | null;
  newPlannedDate: CalendarDate;
  newPlannedStartTime: TimeOfDay;
  newStatus: PackageVisitPlanStatus;
  changeReason: "initial_plan" | "manual_single_move" | "cadence_regeneration" | "linked_to_visit";
  packageAmendmentId: string | null;
}

export interface NewServiceVisitNotificationRow {
  serviceVisitId: string;
  customerId: string;
  notificationType: ServiceVisitNotificationType;
  channel: ServiceVisitNotificationChannel;
  scheduledSendAt: Date;
  idempotencyKey: string;
}

export interface ServiceVisitNotificationRow extends NewServiceVisitNotificationRow {
  id: string;
  state: ServiceVisitNotificationState;
  sentAt: Date | null;
  failureReason: string | null;
  retryCount: number;
  providerMessageId: string | null;
  claimedAt: Date | null;
}


// -- Customer Portal V1: universal recurring_visit_plans -------------------

export interface RecurringVisitPlanRow {
  id: string;
  recurringScheduleId: string;
  customerId: string;
  visitNumber: number;
  plannedDate: CalendarDate;
  plannedStartTime: TimeOfDay;
  status: RecurringVisitPlanStatus;
  serviceVisitId: string | null;
}

export interface NewRecurringVisitPlanRow {
  recurringScheduleId: string;
  customerId: string;
  visitNumber: number;
  plannedDate: CalendarDate;
  plannedStartTime: TimeOfDay;
}

export interface NewRecurringVisitPlanHistoryRow {
  recurringVisitPlanId: string;
  recurringScheduleId: string;
  visitNumber: number;
  previousPlannedDate: CalendarDate | null;
  previousPlannedStartTime: TimeOfDay | null;
  previousStatus: RecurringVisitPlanStatus | null;
  newPlannedDate: CalendarDate;
  newPlannedStartTime: TimeOfDay;
  newStatus: RecurringVisitPlanStatus;
  changeReason: RecurringVisitPlanHistoryChangeReason;
}

// -- Customer Portal V1: recurring_scope_versions ---------------------------

export interface RecurringScopeVersionRow {
  id: string;
  recurringScheduleId: string;
  customerId: string;
  baseCalculationInput: CalculationInput;
  approvedBaseAmount: number | null;
  pricingSnapshot: unknown | null;
  status: RecurringScopeVersionStatus;
  effectiveFromVisitNumber: number;
  supersedesId: string | null;
  requestedBy: string | null;
  reason: string | null;
}

export interface NewRecurringScopeVersionRow {
  recurringScheduleId: string;
  customerId: string;
  baseCalculationInput: CalculationInput;
  approvedBaseAmount: number | null;
  pricingSnapshot: unknown | null;
  effectiveFromVisitNumber: number;
  supersedesId: string | null;
  requestedBy: string | null;
  reason: string | null;
}

// -- Customer Portal V1: service_visit_pricing ------------------------------

export interface NewServiceVisitPricingRow {
  serviceVisitId: string;
  pricingVersion: string;
  pricingSnapshot: unknown;
  baseAmount: number;
  addOnIds: AddOnId[];
  addOnAmount: number;
  totalAmount: number;
  amountDueFromCustomer: number;
  priceStatus: ServiceVisitPricingPriceStatus;
  requiresCustomerApproval: boolean;
  previouslyApprovedAmount: number | null;
}

export interface ServiceVisitPricingRow extends NewServiceVisitPricingRow {
  id: string;
  paymentStatus: ServiceVisitPricingPaymentStatus;
  confirmedAt: Date | null;
  confirmedBy: string | null;
}
