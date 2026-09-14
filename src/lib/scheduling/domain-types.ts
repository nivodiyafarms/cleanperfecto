import type { AddOnId, CalculationInput, CleaningType, FrequencyId } from "@/lib/pricing/types";
import type {
  CalendarDate,
  FeeAssessmentState,
  FeeType,
  PackageAmendmentApprovalState,
  PackageAmendmentPaymentState,
  PackageVisitPlanStatus,
  PaymentMethodType,
  RecurringCadence,
  RecurringScheduleStatus,
  RecurringScopeVersionStatus,
  RecurringVisitPlanHistoryChangeReason,
  RecurringVisitPlanStatus,
  ServiceVisitNotificationChannel,
  ServiceVisitNotificationState,
  ServiceVisitNotificationType,
  ServiceVisitPaymentStatus,
  ServiceVisitPricingPaymentStatus,
  ServiceVisitPricingPriceStatus,
  ServiceVisitStatus,
  TaxTransactionStatus,
  TimeOfDay,
  TipSelectionType,
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
  /** Admin override: when true, completing this visit never enqueues a review_request. Never set automatically. */
  reviewRequestSuppressed: boolean;
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
  /**
   * The exact original amount actually charged (subtotal, inclusive of
   * whatever Stripe Tax collected at checkout) — the immutable snapshot
   * cancellation refunds must be computed from (packageTotalPaid ×
   * remainingVisitCount / purchasedVisitCount), never re-derived from
   * current pricing. See refund-prepaid-package.ts. Optional here (rather
   * than on every existing PrepaidPackageRow fixture across this
   * codebase's many pre-existing scheduling tests, which have nothing to
   * do with refunds) — refund-prepaid-package.ts treats a missing value
   * as a data-integrity error, never silently defaults it.
   */
  packageTotalPaid?: number;
  /** The actual per-visit price charged at purchase (prepaid_packages.effective_price_per_visit) — a historical fact, used as the basis for a package amendment's "old value," never re-derived from the pricing engine (which could drift from what was actually paid if config changed since purchase). */
  effectivePricePerVisit: number;
  status: "active" | "completed" | "cancelled";
  /** Used to pick the oldest active package first when resolving which package a newly-scheduled recurring visit should draw a credit from (see findActivePrepaidPackageForCustomer / schedule-recurring-visit-plan.ts). */
  purchasedAt: Date;
  /** Set only on cancellation — the exact dollar amount refunded to the original payment method for unused visit credits (0 when all purchased visits had already been completed). Optional for the same pre-existing-fixture reason as packageTotalPaid; refund-prepaid-package.ts treats a missing value as 0 (not yet refunded), same as the DB column's own default. */
  refundedAmount?: number;
  refundedAt?: Date | null;
  cancelledAt?: Date | null;
  cancellationReason?: string | null;
}

export type TaxReversalReconciliationTargetType = "service_visit_payment" | "prepaid_package";
export type TaxReversalReconciliationStatus = "pending" | "succeeded" | "failed";
export type TaxReversalReconciliationMode = "full" | "partial";

/** Durable recovery record for one refund event's owed Stripe Tax reversal — see 20260914090300_create_tax_reversal_reconciliations.sql and attempt-tax-reversal.ts. */
export interface NewTaxReversalReconciliationRow {
  targetEntityType: TaxReversalReconciliationTargetType;
  targetEntityId: string;
  originalTransactionId: string;
  intendedAmount: number;
  mode: TaxReversalReconciliationMode;
}

export interface TaxReversalReconciliationRow extends NewTaxReversalReconciliationRow {
  id: string;
  status: TaxReversalReconciliationStatus;
  stripeReversalId: string | null;
  failureMessage: string | null;
  retryCount: number;
  createdAt: Date;
  lastAttemptedAt: Date | null;
  succeededAt: Date | null;
}

export interface ServiceFeeAssessmentRow {
  id: string;
  serviceVisitId: string;
  feeType: FeeType;
  amount: number;
  policyVersion: string;
  reason: string | null;
  state: FeeAssessmentState;
  /** Set exactly once, only on a successful collection — see collect_service_fee_assessment_with_audit. 'stripe_card' is schema-ready but has no live caller yet (no off-session Stripe charge capability exists in this milestone). */
  collectionMethod?: "zelle" | "cash" | "stripe_card" | null;
  externalPaymentReference?: string | null;
  stripePaymentIntentId?: string | null;
  collectedAt?: Date | null;
}

/** Persisted charge.dispute.created/.updated/.closed fact — see 20260914090600_create_stripe_disputes.sql. Deliberately separate from ServiceVisitPaymentRow: a dispute must never make a paid visit look refunded/unpaid. */
export interface StripeDisputeRow {
  id: string;
  stripeDisputeId: string;
  stripeChargeId: string;
  stripePaymentIntentId: string | null;
  serviceVisitPaymentId: string | null;
  serviceVisitId: string | null;
  amount: number;
  currency: string;
  /** Free text, not a closed enum — Stripe's own SDK type has a forward-compatibility fallback for values it may add. Also represents the outcome (won/lost) — Stripe exposes no separate outcome field. */
  disputeStatus: string;
  reason: string | null;
  stripeCreatedAt: Date;
  lastStripeEventId: string;
  lastStripeEventCreatedAt: Date;
  closedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewStripeDisputeEventRow {
  stripeDisputeId: string;
  stripeChargeId: string;
  stripePaymentIntentId: string | null;
  amount: number;
  currency: string;
  disputeStatus: string;
  reason: string | null;
  stripeCreatedAt: Date;
  stripeEventId: string;
  stripeEventCreatedAt: Date;
  isClosed: boolean;
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
  /** Null only for notificationType='consent_required' (consent is customer-level and can fire before any real service_visit exists, e.g. a prepaid package before its first visit is scheduled) — see service_visit_notifications_visit_required_unless_consent_request. */
  serviceVisitId: string | null;
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

// -- Payments V1: service_visit_payments ------------------------------------

export interface NewServiceVisitPaymentRow {
  serviceVisitId: string;
  serviceVisitPricingId: string;
  approvedAmount: number;
  idempotencyKey: string;
}

export interface ServiceVisitPaymentRow {
  id: string;
  serviceVisitId: string;
  serviceVisitPricingId: string;

  approvedAmount: number;
  tipBasisAmount: number | null;
  tipSelectionType: TipSelectionType | null;
  tipPercentage: number | null;
  tipAmount: number | null;
  taxAmount: number | null;
  totalAmount: number | null;

  tipSelectedAt: Date | null;
  tipConfirmedAt: Date | null;

  taxLocationSnapshot: Record<string, unknown> | null;
  currency: string;

  paymentMethodType: PaymentMethodType | null;

  stripeCustomerId: string | null;
  stripePaymentMethodId: string | null;
  cardBrand: string | null;
  cardLast4: string | null;
  stripePaymentIntentId: string | null;

  stripeTaxCalculationId: string | null;
  taxCalculationExpiresAt: Date | null;
  taxTransactionStatus: TaxTransactionStatus;
  stripeTaxTransactionId: string | null;
  taxTransactionFailureCode: string | null;
  taxTransactionFailureMessage: string | null;
  taxTransactionLastAttemptAt: Date | null;

  externalPaymentReference: string | null;

  status: ServiceVisitPaymentStatus;

  idempotencyKey: string;

  failureCode: string | null;
  failureMessage: string | null;

  refundedAmount: number;
  refundedAt: Date | null;
  paidAt: Date | null;

  createdAt: Date;
  updatedAt: Date;
}

/** Pre-freeze tip/tax update — only valid while tipConfirmedAt is still null (enforced by the DB trigger; the repository also refuses if the row is already frozen). */
export interface ServiceVisitPaymentTipPatch {
  tipBasisAmount: number;
  tipSelectionType: TipSelectionType;
  tipPercentage: number | null;
  tipAmount: number;
  taxAmount: number;
  totalAmount: number;
  /** Null only when nothing is collectible (approvedAmount + tipAmount === 0) — no Stripe Tax Calculation is created in that case. */
  stripeTaxCalculationId: string | null;
  taxCalculationExpiresAt: Date | null;
  taxLocationSnapshot: Record<string, unknown>;
}

/** Freezes the row for the stripe_card rail — sets tipConfirmedAt, so must only be called once per row (the repository enforces via the trigger + a state-guarded WHERE clause). */
export interface ServiceVisitPaymentStripeCardFreezePatch {
  stripeCustomerId: string;
  stripePaymentMethodId: string;
  cardBrand: string | null;
  cardLast4: string | null;
}

/** Freezes the row for an external (zelle/cash) settlement — sets tipConfirmedAt (if not already set) atomically with status='paid'/paid_at, per the two-phase external-payment design (see recordExternalPayment). */
export interface ServiceVisitPaymentExternalSettlementPatch {
  paymentMethodType: Extract<PaymentMethodType, "zelle" | "cash">;
  externalPaymentReference: string | null;
}

export interface ServiceVisitPaymentTaxSyncPatch {
  taxTransactionStatus: TaxTransactionStatus;
  stripeTaxTransactionId?: string | null;
  stripeTaxCalculationId?: string;
  taxCalculationExpiresAt?: Date | null;
  taxTransactionFailureCode?: string | null;
  taxTransactionFailureMessage?: string | null;
}
