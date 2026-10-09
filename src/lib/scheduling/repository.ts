import type {
  ActiveAssignmentIntervalRow,
  CleanerAvailabilityExceptionRow,
  CleanerAvailabilityRuleRow,
  CleanerRow,
  CustomPricingAdjustmentType,
  InvoiceRow,
  NewInvoiceInput,
  NewPackageAmendmentRow,
  NewPackageVisitPlanHistoryRow,
  NewPackageVisitPlanRow,
  NewReceiptInput,
  NewRecurringScheduleRow,
  NewRecurringScopeVersionRow,
  NewRecurringVisitPlanHistoryRow,
  NewRecurringVisitPlanRow,
  NewServiceFeeAssessmentRow,
  NewServiceVisitNotificationRow,
  NewServiceVisitPaymentRow,
  NewServiceVisitPricingRow,
  NewServiceVisitRow,
  NewStripeDisputeEventRow,
  NewTaxReversalReconciliationRow,
  PackageAmendmentRow,
  PackageVisitPlanRow,
  PrepaidPackageRow,
  ReceiptRow,
  RecurringScheduleRow,
  RecurringScopeVersionRow,
  RecurringVisitPlanRow,
  SchedulingDayOverrideRow,
  ServiceFeeAssessmentRow,
  ServiceVisitEventRow,
  ServiceVisitNotificationRow,
  ServiceVisitPaymentExternalSettlementPatch,
  ServiceVisitPaymentRow,
  ServiceVisitPaymentStripeCardFreezePatch,
  ServiceVisitPaymentTaxSyncPatch,
  ServiceVisitPaymentTipPatch,
  ServiceVisitPricingRow,
  ServiceVisitRow,
  StripeDisputeRow,
  TaxReversalReconciliationRow,
} from "./domain-types";
import type { ServiceVisitPaymentStatus } from "./types";
import type {
  CalendarDate,
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
  /** excludeServiceVisitId omits one visit's own assignment(s) from the result — needed when checking cleaner availability for a NEW candidate time on a visit that is ALREADY scheduled (reschedule), so the visit's own current booking is never mistaken for a third-party conflict against itself. Omit when checking availability for a visit that isn't scheduled yet (nothing of its own to exclude). */
  listActiveAssignmentsInRange(rangeStartUtc: Date, rangeEndUtc: Date, excludeServiceVisitId?: string): Promise<ActiveAssignmentIntervalRow[]>;

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
  /** Atomic completion + package-credit consumption via the complete_service_visit() Postgres function. Accepts a visit currently 'scheduled' or 'work_finished'. */
  completeServiceVisitRpc(serviceVisitId: string): Promise<void>;
  /** Idempotent scheduled -> work_finished transition via the mark_service_visit_work_finished() Postgres function. */
  markServiceVisitWorkFinishedRpc(serviceVisitId: string): Promise<void>;
  cancelServiceVisit(serviceVisitId: string): Promise<boolean>;
  /** Admin toggle — never set automatically. See enqueue-review-request.ts. */
  setReviewRequestSuppressed(serviceVisitId: string, suppressed: boolean): Promise<void>;

  // -- events / fees / reminders ---------------------------------------
  insertServiceVisitEvent(row: ServiceVisitEventRow): Promise<void>;
  insertServiceFeeAssessment(row: NewServiceFeeAssessmentRow): Promise<ServiceFeeAssessmentRow>;
  /**
   * Atomically waives a fee assessment AND writes the required
   * financial_audit_log actor-attribution row, via a single Postgres RPC
   * (waive_service_fee_assessment_with_audit) — either both commit or
   * neither does. Refuses (throws) unless the row is currently
   * state='assessed', so a duplicate/replayed waiver can never grow the
   * reason text or double-audit the same logical action. Never touches
   * amount/feeType/policyVersion, which stay a frozen record of what was
   * actually assessed. The given reason is appended to any existing
   * assessment reason (e.g. why the fee was waived) rather than
   * overwriting it.
   */
  waiveServiceFeeAssessmentWithAudit(
    id: string,
    reason: string,
    audit: { actorAdminUserId: string; actorRole: string }
  ): Promise<ServiceFeeAssessmentRow>;
  /**
   * Phase H — atomically records a fee COLLECTION (distinct from
   * assessment and from waiver) AND writes the required
   * financial_audit_log actor-attribution row, via a single Postgres RPC
   * (collect_service_fee_assessment_with_audit). Refuses (throws) unless
   * the row is currently state='assessed' — no duplicate/over-collection,
   * and a failed collection attempt (application code deciding not to
   * call this at all) never erases or alters the assessment. See
   * src/lib/payments/collect-service-fee.ts, the sole caller.
   */
  collectServiceFeeAssessmentWithAudit(
    id: string,
    patch: { collectionMethod: "zelle" | "cash" | "stripe_card"; externalPaymentReference: string | null; stripePaymentIntentId: string | null },
    audit: { actorAdminUserId: string; actorRole: string }
  ): Promise<ServiceFeeAssessmentRow>;

  /**
   * Phase C — the sole writer of stripe_disputes. Guarded so a stale,
   * duplicate, or out-of-order charge.dispute.* webhook delivery (by the
   * event's own created timestamp) can never regress an already-applied
   * dispute state — see upsert_stripe_dispute_event. No financial_audit_log
   * row (pure Stripe-webhook-driven fact recording, no admin actor — same
   * class of mutation as reconcileVisitPayment).
   */
  upsertStripeDisputeEvent(input: NewStripeDisputeEventRow): Promise<StripeDisputeRow>;

  // -- Phase I: invoices / receipts ----------------------------------------
  /** Snapshotted onto an invoice/receipt at issuance — see InvoiceRow.customerDisplayName. Falls back to "Customer" if the row is somehow missing rather than throwing, since a documentation lookup must never block issuance of the underlying financial fact. */
  findCustomerDisplayName(customerId: string): Promise<string>;
  /** Allocates the next CP-INV-YYYY-###### number and inserts the row atomically via issue_invoice(). Sole caller: src/lib/invoicing/issue-invoice.ts. */
  issueInvoice(input: NewInvoiceInput): Promise<InvoiceRow>;
  /** Allocates the next CP-RCT-YYYY-###### number and inserts the row atomically via issue_receipt(). Sole caller: src/lib/invoicing/issue-receipt.ts. */
  issueReceipt(input: NewReceiptInput): Promise<ReceiptRow>;
  /**
   * Idempotent, concurrency-safe combined issuance for the visit-payment
   * settlement rail (stripe_card and zelle/cash both funnel through this —
   * see src/lib/invoicing/issue-documents-for-visit-payment.ts, the sole
   * caller). Serializes on serviceVisitPaymentId via
   * issue_visit_payment_documents()'s transaction-scoped advisory lock, so
   * two concurrent or duplicate calls for the same settlement (two racing
   * webhook deliveries, or two distinct Stripe events both resolving to the
   * same payment) never produce a second invoice/receipt pair —
   * alreadyIssued:true means the returned pair is the one from a prior
   * call, not newly created. Deliberately keyed on serviceVisitPaymentId
   * only, never serviceVisitId (a visit can legitimately carry more than
   * one invoice over its lifetime — e.g. a separate cancellation-fee
   * invoice, or a voided-then-reissued correction — so uniqueness can't
   * live there).
   */
  issueVisitPaymentDocumentsIdempotent(input: {
    serviceVisitPaymentId: string;
    invoice: NewInvoiceInput;
    receipt: Omit<NewReceiptInput, "invoiceId">;
  }): Promise<{ invoice: InvoiceRow; receipt: ReceiptRow; alreadyIssued: boolean }>;
  findInvoiceById(id: string): Promise<InvoiceRow | null>;
  findReceiptById(id: string): Promise<ReceiptRow | null>;
  /** Newest first (issueDate desc) — the customer's own billing history. */
  listInvoicesForCustomer(customerId: string): Promise<InvoiceRow[]>;
  listReceiptsForCustomer(customerId: string): Promise<ReceiptRow[]>;
  /**
   * Atomically voids an invoice AND writes the required financial_audit_log
   * actor-attribution row, via void_invoice_with_audit(). Idempotent no-op
   * if already void. Owner-only in application code — see
   * assertCapability("financial_correction") in the calling admin action.
   */
  voidInvoiceWithAudit(id: string, reason: string, audit: { actorAdminUserId: string; actorRole: string }): Promise<InvoiceRow>;
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
  /** booking_order_id is UNIQUE on prepaid_packages — used right after activatePrepaidPackage() (BookingRepository) to fetch the just-created row for invoice/receipt issuance, since that method returns only {inserted: boolean}. */
  findPrepaidPackageByBookingOrderId(bookingOrderId: string): Promise<PrepaidPackageRow | null>;
  /** The oldest active prepaid package still carrying credit for this customer (remaining_visit_count > 0), or null if none — resolved fresh at the moment a recurring_visit_plans row is turned into a real visit, never decided upfront by the schedule itself. Once every package is exhausted, this returns null and later visits become Pay Per Cleaning. */
  findActivePrepaidPackageForCustomer(customerId: string): Promise<PrepaidPackageRow | null>;
  /**
   * Atomically cancels a prepaid_packages row (status -> cancelled) AND
   * records the required financial_audit_log actor-attribution row, via a
   * single Postgres RPC (cancel_prepaid_package_with_refund_audit) — either
   * both commit or neither does. Eligible only from status='active' (no
   * double-cancel); rejects a refund amount exceeding the original
   * package_total_paid. See src/lib/payments/refund-prepaid-package.ts,
   * the sole caller.
   */
  cancelPrepaidPackageWithRefundAudit(
    id: string,
    patch: { refundAmount: number; refundTaxAmount: number; totalRefundAmount: number | null; stripeRefundId: string | null; reason: string },
    audit: { actorAdminUserId: string; actorRole: string }
  ): Promise<PrepaidPackageRow>;
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
  /**
   * Atomically appends one custom charge/discount to
   * service_visit_pricing.custom_adjustments (updating the matching
   * aggregate column) AND records the required financial_audit_log
   * actor-attribution row, via a single Postgres RPC
   * (add_custom_pricing_adjustment_with_audit) — either both commit or
   * neither does. Rejects a non-positive amount, a blank description, or a
   * discount that would drive the payable amount below $0 against the
   * row's currently persisted base/add-on amounts (a defensive backstop —
   * see src/lib/scheduling/add-custom-pricing-adjustment.ts, the sole
   * caller, which always re-runs estimateVisitPricing() immediately
   * afterward for the actual authoritative total/approval recompute).
   */
  addCustomPricingAdjustmentWithAudit(
    serviceVisitPricingId: string,
    adjustment: { type: CustomPricingAdjustmentType; description: string; amount: number },
    audit: { actorAdminUserId: string; actorRole: string }
  ): Promise<ServiceVisitPricingRow>;
  /**
   * Atomically removes one custom charge/discount (by its own id) from
   * service_visit_pricing.custom_adjustments (updating the matching
   * aggregate column) AND records the required financial_audit_log
   * actor-attribution row, via a single Postgres RPC
   * (remove_custom_pricing_adjustment_with_audit). Raises if the
   * adjustment id does not exist on this row. See
   * src/lib/scheduling/remove-custom-pricing-adjustment.ts, the sole
   * caller.
   */
  removeCustomPricingAdjustmentWithAudit(
    serviceVisitPricingId: string,
    adjustmentId: string,
    audit: { actorAdminUserId: string; actorRole: string }
  ): Promise<ServiceVisitPricingRow>;
  updateServiceVisitPricingPaymentStatus(
    serviceVisitId: string,
    paymentStatus: ServiceVisitPricingPaymentStatus
  ): Promise<ServiceVisitPricingRow | null>;

  // -- service_visit_payments (Pay-Per-Cleaning + Tipping V1) --------------
  findServiceVisitPaymentByVisitId(serviceVisitId: string): Promise<ServiceVisitPaymentRow | null>;
  findServiceVisitPaymentById(id: string): Promise<ServiceVisitPaymentRow | null>;
  findServiceVisitPaymentByStripePaymentIntentId(stripePaymentIntentId: string): Promise<ServiceVisitPaymentRow | null>;
  /** Insert-or-fetch-existing via the unique service_visit_id — same idempotent-insert convention as insertSentRequest/insertServiceVisitNotification. `inserted` tells the caller whether this call created the row. */
  insertServiceVisitPaymentAttempt(row: NewServiceVisitPaymentRow): Promise<{ inserted: boolean; record: ServiceVisitPaymentRow }>;
  /** Pre-freeze only — rejected by the DB trigger (and refused here first) once tipConfirmedAt is already set. Freely re-callable as the customer changes their tip selection. */
  updateServiceVisitPaymentTip(id: string, patch: ServiceVisitPaymentTipPatch): Promise<ServiceVisitPaymentRow>;
  /** Freezes the row (sets tipConfirmedAt) for the stripe_card rail. Refuses (throws) if already frozen. */
  freezeServiceVisitPaymentForStripeCard(id: string, patch: ServiceVisitPaymentStripeCardFreezePatch): Promise<ServiceVisitPaymentRow>;
  /** Freezes the row with no rail at all — the collectible total (approvedAmount + tip) resolved to exactly $0, so no PaymentIntent is ever created. status -> 'no_payment_due'. Refuses if already frozen. */
  freezeServiceVisitPaymentAsNoPaymentDue(id: string): Promise<ServiceVisitPaymentRow>;
  /** Settable exactly once from null (enforced by the DB trigger) — the created PaymentIntent id, alongside the attempt-level status it produced. */
  setServiceVisitPaymentIntent(id: string, params: { stripePaymentIntentId: string; status: ServiceVisitPaymentRow["status"] }): Promise<ServiceVisitPaymentRow>;
  /**
   * General attempt-status transition (processing/requires_action/paid/payment_failed) — never touches the frozen financial facts.
   * `allowedFromStatuses` is a compare-and-swap guard (same idiom as updateBookingOrderStatus's expectedStatus): the update only
   * applies if the row's CURRENT status is one of these — see payment-status-transitions.ts for the authoritative table. Returns
   * null both when the row doesn't exist AND when it exists but its current status isn't in `allowedFromStatuses` (a blocked
   * stale/out-of-order transition) — callers already treat null as "nothing to reconcile," which is the correct behavior for both.
   */
  updateServiceVisitPaymentStatus(
    id: string,
    patch: { status: ServiceVisitPaymentRow["status"]; failureCode?: string | null; failureMessage?: string | null; paidAt?: Date | null },
    allowedFromStatuses: readonly ServiceVisitPaymentStatus[]
  ): Promise<ServiceVisitPaymentRow | null>;
  /**
   * Atomically settles an external (zelle/cash) payment AND writes the
   * required financial_audit_log actor-attribution row, via a single
   * Postgres RPC (record_external_visit_payment_with_audit) — either both
   * commit or neither does. Freezes the row (if not already), sets
   * status='paid'/paidAt, initializes taxTransactionStatus='pending', and
   * transitions service_visit_pricing.payment_status to 'paid', all in one
   * transaction. Refuses if the row is already settled/mid-Stripe-attempt.
   * The Stripe Tax transaction commit itself remains a separate,
   * deliberately best-effort step after this call returns — see
   * record-external-payment.ts.
   */
  recordExternalServiceVisitPaymentWithAudit(
    id: string,
    patch: ServiceVisitPaymentExternalSettlementPatch,
    audit: { actorAdminUserId: string; actorRole: string }
  ): Promise<ServiceVisitPaymentRow>;
  /** Tax-sync-only update — never touches status/paidAt/any frozen financial fact. Used by both the stripe_card reconciliation path and the external retry-tax-sync path. */
  updateServiceVisitPaymentTaxSync(id: string, patch: ServiceVisitPaymentTaxSyncPatch): Promise<ServiceVisitPaymentRow | null>;
  /** Refund reconciliation from charge.refunded — never touches tip/tax/total, only refund + status fields. `allowedFromStatuses` is the same CAS guard as updateServiceVisitPaymentStatus, see payment-status-transitions.ts. */
  updateServiceVisitPaymentRefund(
    id: string,
    patch: { refundedAmount: number; refundedAt: Date; status: "partially_refunded" | "refunded" },
    allowedFromStatuses: readonly ServiceVisitPaymentStatus[]
  ): Promise<ServiceVisitPaymentRow | null>;
  /**
   * Atomically applies an admin-issued refund AND writes the required
   * financial_audit_log actor-attribution row, via a single Postgres RPC
   * (refund_visit_payment_with_audit) — either both commit or neither does.
   * Refundable only from status paid/partially_refunded (Phase A's
   * terminal-state rules, enforced at the DB layer); rejects an amount
   * that would exceed the remaining refundable balance (no over-refund).
   * See src/lib/payments/refund-visit-payment.ts, the sole caller.
   */
  refundServiceVisitPaymentWithAudit(
    id: string,
    patch: { refundAmount: number; stripeRefundId: string; reason: string },
    audit: { actorAdminUserId: string; actorRole: string }
  ): Promise<ServiceVisitPaymentRow>;

  /**
   * Phase F.1 — durably persists intent to reverse a Stripe Tax
   * transaction BEFORE the Stripe API call is ever attempted. See
   * src/lib/payments/attempt-tax-reversal.ts, the sole caller.
   */
  createTaxReversalReconciliation(input: NewTaxReversalReconciliationRow): Promise<TaxReversalReconciliationRow>;

  findTaxReversalReconciliationById(id: string): Promise<TaxReversalReconciliationRow | null>;

  /** Owner/admin visibility into pending/failed/succeeded reconciliation state for a given payment or package. */
  listTaxReversalReconciliationsForTarget(
    targetEntityType: "service_visit_payment" | "prepaid_package",
    targetEntityId: string
  ): Promise<TaxReversalReconciliationRow[]>;

  /**
   * Atomically records a successful Stripe Tax reversal AND the required
   * financial_audit_log actor-attribution row, via a single Postgres RPC
   * (mark_tax_reversal_reconciliation_succeeded). Idempotent — a no-op
   * (no second audit row) if already succeeded. See
   * src/lib/payments/attempt-tax-reversal.ts, the sole caller.
   */
  markTaxReversalReconciliationSucceeded(
    id: string,
    stripeReversalId: string,
    audit: { actorAdminUserId: string; actorRole: string }
  ): Promise<TaxReversalReconciliationRow>;

  /** Records a transient Stripe Tax reversal failure for later retry — never writes financial_audit_log. See src/lib/payments/attempt-tax-reversal.ts, the sole caller. */
  markTaxReversalReconciliationFailed(id: string, failureMessage: string): Promise<TaxReversalReconciliationRow>;
}
