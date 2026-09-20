import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type {
  ActiveAssignmentIntervalRow,
  CleanerAvailabilityExceptionRow,
  CleanerAvailabilityRuleRow,
  CleanerRow,
  InvoiceAddOnLine,
  InvoiceRow,
  NewPackageAmendmentRow,
  NewPackageVisitPlanHistoryRow,
  NewPackageVisitPlanRow,
  NewRecurringScheduleRow,
  NewRecurringScopeVersionRow,
  NewRecurringVisitPlanHistoryRow,
  NewRecurringVisitPlanRow,
  NewServiceFeeAssessmentRow,
  NewServiceVisitNotificationRow,
  NewServiceVisitPaymentRow,
  NewServiceVisitPricingRow,
  NewServiceVisitRow,
  PackageAmendmentRow,
  PackageVisitPlanRow,
  PrepaidPackageRow,
  ReceiptRow,
  RecurringScheduleRow,
  RecurringScopeVersionRow,
  RecurringVisitPlanRow,
  SchedulingDayOverrideRow,
  ServiceFeeAssessmentRow,
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
import { InvalidVisitStateError, SchedulingConflictError } from "./errors";
import type { SchedulingRepository } from "./repository";

function toServiceVisitRow(row: Record<string, unknown>): ServiceVisitRow {
  return {
    id: row.id as string,
    customerId: row.customer_id as string,
    quoteRequestId: (row.quote_request_id as string | null) ?? null,
    bookingOrderId: (row.booking_order_id as string | null) ?? null,
    prepaidPackageId: (row.prepaid_package_id as string | null) ?? null,
    recurringScheduleId: (row.recurring_schedule_id as string | null) ?? null,
    visitNumber: (row.visit_number as number | null) ?? null,
    cleaningType: (row.cleaning_type as ServiceVisitRow["cleaningType"]) ?? null,
    frequency: (row.frequency as ServiceVisitRow["frequency"]) ?? null,
    status: row.status as ServiceVisitRow["status"],
    requestedStartAt: row.requested_start_at ? new Date(row.requested_start_at as string) : null,
    confirmedAt: row.confirmed_at ? new Date(row.confirmed_at as string) : null,
    confirmedStartAt: row.confirmed_start_at ? new Date(row.confirmed_start_at as string) : null,
    confirmedEndAt: row.confirmed_end_at ? new Date(row.confirmed_end_at as string) : null,
    estimatedLaborMinutes: (row.estimated_labor_minutes as number | null) ?? null,
    estimatedServiceMinutes: (row.estimated_service_minutes as number | null) ?? null,
    recommendedCleanerCount: (row.recommended_cleaner_count as number | null) ?? null,
    turnaroundBufferMinutes: (row.turnaround_buffer_minutes as number | null) ?? null,
    timezone: row.timezone as string,
    workFinishedAt: row.work_finished_at ? new Date(row.work_finished_at as string) : null,
    completedAt: row.completed_at ? new Date(row.completed_at as string) : null,
    cancelledAt: row.cancelled_at ? new Date(row.cancelled_at as string) : null,
    serviceAddressLine1: (row.service_address_line1 as string | null) ?? null,
    serviceAddressLine2: (row.service_address_line2 as string | null) ?? null,
    serviceCity: (row.service_city as string | null) ?? null,
    serviceState: (row.service_state as string | null) ?? null,
    serviceAddressIdentity: (row.service_address_identity as string | null) ?? null,
    reviewRequestSuppressed: (row.review_request_suppressed as boolean | null) ?? false,
  };
}

function toServiceVisitNotificationRow(row: Record<string, unknown>): ServiceVisitNotificationRow {
  return {
    id: row.id as string,
    serviceVisitId: (row.service_visit_id as string | null) ?? null,
    customerId: row.customer_id as string,
    notificationType: row.notification_type as ServiceVisitNotificationRow["notificationType"],
    channel: row.channel as ServiceVisitNotificationRow["channel"],
    scheduledSendAt: new Date(row.scheduled_send_at as string),
    idempotencyKey: row.idempotency_key as string,
    state: row.state as ServiceVisitNotificationRow["state"],
    sentAt: row.sent_at ? new Date(row.sent_at as string) : null,
    failureReason: (row.failure_reason as string | null) ?? null,
    retryCount: row.retry_count as number,
    providerMessageId: (row.provider_message_id as string | null) ?? null,
    claimedAt: row.claimed_at ? new Date(row.claimed_at as string) : null,
  };
}

function toRecurringScheduleRow(row: Record<string, unknown>): RecurringScheduleRow {
  return {
    id: row.id as string,
    customerId: row.customer_id as string,
    bookingOrderId: (row.booking_order_id as string | null) ?? null,
    prepaidPackageId: (row.prepaid_package_id as string | null) ?? null,
    cadence: row.cadence as RecurringScheduleRow["cadence"],
    preferredDayOfWeek: row.preferred_day_of_week as number,
    preferredStartTime: row.preferred_start_time as string,
    timezone: row.timezone as string,
    status: row.status as RecurringScheduleRow["status"],
    effectiveFrom: row.effective_from as string,
    effectiveUntil: (row.effective_until as string | null) ?? null,
    supersedesId: (row.supersedes_id as string | null) ?? null,
  };
}

function toPackageVisitPlanRow(row: Record<string, unknown>): PackageVisitPlanRow {
  return {
    id: row.id as string,
    prepaidPackageId: row.prepaid_package_id as string,
    visitNumber: row.visit_number as number,
    plannedDate: row.planned_date as string,
    plannedStartTime: row.planned_start_time as string,
    status: row.status as PackageVisitPlanRow["status"],
    serviceVisitId: (row.service_visit_id as string | null) ?? null,
    generatedFromRecurringScheduleId: (row.generated_from_recurring_schedule_id as string | null) ?? null,
    recurringVisitPlanId: (row.recurring_visit_plan_id as string | null) ?? null,
  };
}

function toPrepaidPackageRow(row: Record<string, unknown>): PrepaidPackageRow {
  return {
    id: row.id as string,
    customerId: row.customer_id as string,
    bookingOrderId: row.booking_order_id as string,
    frequency: row.frequency as PrepaidPackageRow["frequency"],
    purchasedVisitCount: row.purchased_visit_count as number,
    remainingVisitCount: row.remaining_visit_count as number,
    packageTotalPaid: Number(row.package_total_paid),
    taxAmount: row.tax_amount === null || row.tax_amount === undefined ? null : Number(row.tax_amount),
    totalAmountPaid: row.total_amount_paid === null || row.total_amount_paid === undefined ? null : Number(row.total_amount_paid),
    stripeTaxTransactionId: (row.stripe_tax_transaction_id as string | null) ?? null,
    effectivePricePerVisit: Number(row.effective_price_per_visit),
    status: row.status as PrepaidPackageRow["status"],
    purchasedAt: new Date(row.purchased_at as string),
    refundedAmount: Number(row.refunded_amount ?? 0),
    refundedTaxAmount: Number(row.refunded_tax_amount ?? 0),
    totalRefundedAmount: row.total_refunded_amount === null || row.total_refunded_amount === undefined ? null : Number(row.total_refunded_amount),
    refundedAt: row.refunded_at ? new Date(row.refunded_at as string) : null,
    cancelledAt: row.cancelled_at ? new Date(row.cancelled_at as string) : null,
    cancellationReason: (row.cancellation_reason as string | null) ?? null,
  };
}

function toRecurringVisitPlanRow(row: Record<string, unknown>): RecurringVisitPlanRow {
  return {
    id: row.id as string,
    recurringScheduleId: row.recurring_schedule_id as string,
    customerId: row.customer_id as string,
    visitNumber: row.visit_number as number,
    plannedDate: row.planned_date as string,
    plannedStartTime: row.planned_start_time as string,
    status: row.status as RecurringVisitPlanRow["status"],
    serviceVisitId: (row.service_visit_id as string | null) ?? null,
  };
}

function toRecurringScopeVersionRow(row: Record<string, unknown>): RecurringScopeVersionRow {
  return {
    id: row.id as string,
    recurringScheduleId: row.recurring_schedule_id as string,
    customerId: row.customer_id as string,
    baseCalculationInput: row.base_calculation_input as RecurringScopeVersionRow["baseCalculationInput"],
    approvedBaseAmount: row.approved_base_amount === null ? null : Number(row.approved_base_amount),
    pricingSnapshot: row.pricing_snapshot ?? null,
    status: row.status as RecurringScopeVersionRow["status"],
    effectiveFromVisitNumber: row.effective_from_visit_number as number,
    supersedesId: (row.supersedes_id as string | null) ?? null,
    requestedBy: (row.requested_by as string | null) ?? null,
    reason: (row.reason as string | null) ?? null,
  };
}

function toServiceVisitPricingRow(row: Record<string, unknown>): ServiceVisitPricingRow {
  return {
    id: row.id as string,
    serviceVisitId: row.service_visit_id as string,
    pricingVersion: row.pricing_version as string,
    pricingSnapshot: row.pricing_snapshot,
    baseAmount: Number(row.base_amount),
    addOnIds: (row.add_on_ids as ServiceVisitPricingRow["addOnIds"]) ?? [],
    addOnAmount: Number(row.add_on_amount),
    totalAmount: Number(row.total_amount),
    amountDueFromCustomer: Number(row.amount_due_from_customer),
    priceStatus: row.price_status as ServiceVisitPricingRow["priceStatus"],
    paymentStatus: row.payment_status as ServiceVisitPricingRow["paymentStatus"],
    previouslyApprovedAmount: row.previously_approved_amount === null ? null : Number(row.previously_approved_amount),
    requiresCustomerApproval: row.requires_customer_approval as boolean,
    confirmedAt: row.confirmed_at ? new Date(row.confirmed_at as string) : null,
    confirmedBy: (row.confirmed_by as string | null) ?? null,
  };
}

function toServiceVisitPaymentRow(row: Record<string, unknown>): ServiceVisitPaymentRow {
  return {
    id: row.id as string,
    serviceVisitId: row.service_visit_id as string,
    serviceVisitPricingId: row.service_visit_pricing_id as string,
    approvedAmount: Number(row.approved_amount),
    tipBasisAmount: row.tip_basis_amount === null ? null : Number(row.tip_basis_amount),
    tipSelectionType: (row.tip_selection_type as ServiceVisitPaymentRow["tipSelectionType"]) ?? null,
    tipPercentage: row.tip_percentage === null ? null : Number(row.tip_percentage),
    tipAmount: row.tip_amount === null ? null : Number(row.tip_amount),
    taxAmount: row.tax_amount === null ? null : Number(row.tax_amount),
    totalAmount: row.total_amount === null ? null : Number(row.total_amount),
    tipSelectedAt: row.tip_selected_at ? new Date(row.tip_selected_at as string) : null,
    tipConfirmedAt: row.tip_confirmed_at ? new Date(row.tip_confirmed_at as string) : null,
    taxLocationSnapshot: (row.tax_location_snapshot as Record<string, unknown> | null) ?? null,
    currency: row.currency as string,
    paymentMethodType: (row.payment_method_type as ServiceVisitPaymentRow["paymentMethodType"]) ?? null,
    stripeCustomerId: (row.stripe_customer_id as string | null) ?? null,
    stripePaymentMethodId: (row.stripe_payment_method_id as string | null) ?? null,
    cardBrand: (row.card_brand as string | null) ?? null,
    cardLast4: (row.card_last4 as string | null) ?? null,
    stripePaymentIntentId: (row.stripe_payment_intent_id as string | null) ?? null,
    stripeTaxCalculationId: (row.stripe_tax_calculation_id as string | null) ?? null,
    taxCalculationExpiresAt: row.tax_calculation_expires_at ? new Date(row.tax_calculation_expires_at as string) : null,
    taxTransactionStatus: row.tax_transaction_status as ServiceVisitPaymentRow["taxTransactionStatus"],
    stripeTaxTransactionId: (row.stripe_tax_transaction_id as string | null) ?? null,
    taxTransactionFailureCode: (row.tax_transaction_failure_code as string | null) ?? null,
    taxTransactionFailureMessage: (row.tax_transaction_failure_message as string | null) ?? null,
    taxTransactionLastAttemptAt: row.tax_transaction_last_attempt_at ? new Date(row.tax_transaction_last_attempt_at as string) : null,
    externalPaymentReference: (row.external_payment_reference as string | null) ?? null,
    status: row.status as ServiceVisitPaymentRow["status"],
    idempotencyKey: row.idempotency_key as string,
    failureCode: (row.failure_code as string | null) ?? null,
    failureMessage: (row.failure_message as string | null) ?? null,
    refundedAmount: Number(row.refunded_amount),
    refundedAt: row.refunded_at ? new Date(row.refunded_at as string) : null,
    paidAt: row.paid_at ? new Date(row.paid_at as string) : null,
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  };
}

function toTaxReversalReconciliationRow(row: Record<string, unknown>): TaxReversalReconciliationRow {
  return {
    id: row.id as string,
    targetEntityType: row.target_entity_type as TaxReversalReconciliationRow["targetEntityType"],
    targetEntityId: row.target_entity_id as string,
    originalTransactionId: row.original_transaction_id as string,
    intendedAmount: Number(row.intended_amount),
    mode: row.mode as TaxReversalReconciliationRow["mode"],
    status: row.status as TaxReversalReconciliationRow["status"],
    stripeReversalId: (row.stripe_reversal_id as string | null) ?? null,
    failureMessage: (row.failure_message as string | null) ?? null,
    retryCount: Number(row.retry_count),
    createdAt: new Date(row.created_at as string),
    lastAttemptedAt: row.last_attempted_at ? new Date(row.last_attempted_at as string) : null,
    succeededAt: row.succeeded_at ? new Date(row.succeeded_at as string) : null,
  };
}

function toStripeDisputeRow(row: Record<string, unknown>): StripeDisputeRow {
  return {
    id: row.id as string,
    stripeDisputeId: row.stripe_dispute_id as string,
    stripeChargeId: row.stripe_charge_id as string,
    stripePaymentIntentId: (row.stripe_payment_intent_id as string | null) ?? null,
    serviceVisitPaymentId: (row.service_visit_payment_id as string | null) ?? null,
    serviceVisitId: (row.service_visit_id as string | null) ?? null,
    amount: Number(row.amount),
    currency: row.currency as string,
    disputeStatus: row.dispute_status as string,
    reason: (row.reason as string | null) ?? null,
    stripeCreatedAt: new Date(row.stripe_created_at as string),
    lastStripeEventId: row.last_stripe_event_id as string,
    lastStripeEventCreatedAt: new Date(row.last_stripe_event_created_at as string),
    closedAt: row.closed_at ? new Date(row.closed_at as string) : null,
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  };
}

function toInvoiceRow(row: Record<string, unknown>): InvoiceRow {
  return {
    id: row.id as string,
    invoiceNumber: row.invoice_number as string,
    sourceType: row.source_type as InvoiceRow["sourceType"],
    serviceVisitId: (row.service_visit_id as string | null) ?? null,
    prepaidPackageId: (row.prepaid_package_id as string | null) ?? null,
    serviceVisitPricingId: (row.service_visit_pricing_id as string | null) ?? null,
    serviceFeeAssessmentId: (row.service_fee_assessment_id as string | null) ?? null,
    customerId: row.customer_id as string,
    customerDisplayName: row.customer_display_name as string,
    description: row.description as string,
    serviceAddressLine1: (row.service_address_line1 as string | null) ?? null,
    serviceAddressLine2: (row.service_address_line2 as string | null) ?? null,
    serviceCity: (row.service_city as string | null) ?? null,
    serviceState: (row.service_state as string | null) ?? null,
    serviceZip: (row.service_zip as string | null) ?? null,
    serviceDate: (row.service_date as string | null) ?? null,
    cleaningType: (row.cleaning_type as string | null) ?? null,
    issueDate: new Date(row.issue_date as string),
    currency: row.currency as string,
    baseAmount: Number(row.base_amount),
    roomAdjustmentsAmount: Number(row.room_adjustments_amount),
    addOnsAmount: Number(row.add_ons_amount),
    addOnsDetail: (row.add_ons_detail as InvoiceAddOnLine[] | null) ?? [],
    travelAmount: Number(row.travel_amount),
    suppliesAmount: Number(row.supplies_amount),
    discountAmount: Number(row.discount_amount),
    discountDescription: (row.discount_description as string | null) ?? null,
    cancellationFeeAmount: Number(row.cancellation_fee_amount),
    taxAmount: Number(row.tax_amount),
    subtotalAmount: Number(row.subtotal_amount),
    totalAmount: Number(row.total_amount),
    pricingSnapshot: (row.pricing_snapshot as Record<string, unknown> | null) ?? null,
    paymentStatus: row.payment_status as InvoiceRow["paymentStatus"],
    voidAt: row.void_at ? new Date(row.void_at as string) : null,
    voidReason: (row.void_reason as string | null) ?? null,
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  };
}

function toReceiptRow(row: Record<string, unknown>): ReceiptRow {
  return {
    id: row.id as string,
    receiptNumber: row.receipt_number as string,
    invoiceId: row.invoice_id as string,
    customerId: row.customer_id as string,
    sourceType: row.source_type as ReceiptRow["sourceType"],
    serviceVisitPaymentId: (row.service_visit_payment_id as string | null) ?? null,
    serviceFeeAssessmentId: (row.service_fee_assessment_id as string | null) ?? null,
    prepaidPackageId: (row.prepaid_package_id as string | null) ?? null,
    paymentTimestamp: new Date(row.payment_timestamp as string),
    amountPaid: Number(row.amount_paid),
    taxPaid: Number(row.tax_paid),
    tipPaid: Number(row.tip_paid),
    paymentMethodDisplay: row.payment_method_display as string,
    stripePaymentIntentId: (row.stripe_payment_intent_id as string | null) ?? null,
    stripeChargeId: (row.stripe_charge_id as string | null) ?? null,
    currency: row.currency as string,
    createdAt: new Date(row.created_at as string),
  };
}

function toPackageAmendmentRow(row: Record<string, unknown>): PackageAmendmentRow {
  return {
    id: row.id as string,
    prepaidPackageId: row.prepaid_package_id as string,
    oldCadence: row.old_cadence as PackageAmendmentRow["oldCadence"],
    newCadence: row.new_cadence as PackageAmendmentRow["newCadence"],
    effectiveFromVisitNumber: row.effective_from_visit_number as number,
    remainingVisitCountAtAmendment: row.remaining_visit_count_at_amendment as number,
    oldRemainingValue: Number(row.old_remaining_value),
    newRemainingValue: Number(row.new_remaining_value),
    valueDifference: Number(row.value_difference),
    pricingSnapshot: row.pricing_snapshot,
    newRecurringScheduleId: (row.new_recurring_schedule_id as string | null) ?? null,
    reason: (row.reason as string | null) ?? null,
    approvalState: row.approval_state as PackageAmendmentRow["approvalState"],
    paymentState: row.payment_state as PackageAmendmentRow["paymentState"],
    initiatedByNote: (row.initiated_by_note as string | null) ?? null,
  };
}

/** True when a Supabase/PostgREST error represents the service_visit_assignments_no_overlap exclusion_violation (Postgres SQLSTATE 23P01). */
function isExclusionViolation(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === "23P01" || /exclusion_violation|conflicting key value violates exclusion constraint/i.test(error.message ?? "");
}

/**
 * Production Supabase-backed implementation of SchedulingRepository.
 * Deliberately thin, same convention as supabase-booking-repository.ts —
 * orchestration/business logic lives in the domain functions
 * (confirm-service-visit.ts etc.), which are unit-tested against
 * fake-scheduling-repository.ts instead.
 */
export function createSupabaseSchedulingRepository(): SchedulingRepository {
  const supabase = createSupabaseAdminClient();

  return {
    async listActiveCleaners(): Promise<CleanerRow[]> {
      const { data, error } = await supabase.from("cleaners").select("id,name,active").eq("active", true);
      if (error) throw new Error(`[scheduling] cleaners lookup failed: ${error.message}`);
      return (data ?? []).map((r) => ({ id: r.id, name: r.name, active: r.active }));
    },

    async listActiveAvailabilityRules(): Promise<CleanerAvailabilityRuleRow[]> {
      const { data, error } = await supabase
        .from("cleaner_availability_rules")
        .select("id,cleaner_id,day_of_week,start_time,end_time,active")
        .eq("active", true);
      if (error) throw new Error(`[scheduling] cleaner_availability_rules lookup failed: ${error.message}`);
      return (data ?? []).map((r) => ({
        id: r.id,
        cleanerId: r.cleaner_id,
        dayOfWeek: r.day_of_week,
        startTime: r.start_time,
        endTime: r.end_time,
        active: r.active,
      }));
    },

    async listAvailabilityExceptionsForDate(date): Promise<CleanerAvailabilityExceptionRow[]> {
      const { data, error } = await supabase
        .from("cleaner_availability_exceptions")
        .select("id,cleaner_id,exception_date,type,start_time,end_time")
        .eq("exception_date", date);
      if (error) throw new Error(`[scheduling] cleaner_availability_exceptions lookup failed: ${error.message}`);
      return (data ?? []).map((r) => ({
        id: r.id,
        cleanerId: r.cleaner_id,
        exceptionDate: r.exception_date,
        type: r.type,
        startTime: r.start_time,
        endTime: r.end_time,
      }));
    },

    async listDayOverridesForDate(date): Promise<SchedulingDayOverrideRow[]> {
      const { data, error } = await supabase
        .from("scheduling_day_overrides")
        .select("id,override_date,type,block_start_time,block_end_time")
        .eq("override_date", date);
      if (error) throw new Error(`[scheduling] scheduling_day_overrides lookup failed: ${error.message}`);
      return (data ?? []).map((r) => ({
        id: r.id,
        overrideDate: r.override_date,
        type: r.type,
        blockStartTime: r.block_start_time,
        blockEndTime: r.block_end_time,
      }));
    },

    async listActiveAssignmentsInRange(rangeStartUtc, rangeEndUtc, excludeServiceVisitId): Promise<ActiveAssignmentIntervalRow[]> {
      // Queried from service_visits (not service_visit_assignments) so the
      // confirmed_start_at range filter applies to a plain base-table
      // column rather than an embedded/joined one; unassigned_at IS NULL is
      // then applied client-side over the nested assignment rows, avoiding
      // any ambiguity in filtering an embedded resource's own columns.
      let query = supabase
        .from("service_visits")
        .select("confirmed_start_at,confirmed_end_at,turnaround_buffer_minutes,service_visit_assignments(cleaner_id,unassigned_at)")
        .eq("status", "scheduled")
        .gte("confirmed_start_at", rangeStartUtc.toISOString())
        .lt("confirmed_start_at", rangeEndUtc.toISOString());
      if (excludeServiceVisitId) {
        query = query.neq("id", excludeServiceVisitId);
      }
      const { data, error } = await query;
      if (error) throw new Error(`[scheduling] active assignments lookup failed: ${error.message}`);

      const results: ActiveAssignmentIntervalRow[] = [];
      for (const visit of data ?? []) {
        const assignments = (visit.service_visit_assignments ?? []) as { cleaner_id: string; unassigned_at: string | null }[];
        for (const a of assignments) {
          if (a.unassigned_at !== null) continue;
          results.push({
            cleanerId: a.cleaner_id,
            confirmedStartAt: new Date(visit.confirmed_start_at as string),
            confirmedEndAt: new Date(visit.confirmed_end_at as string),
            turnaroundBufferMinutes: visit.turnaround_buffer_minutes as number,
          });
        }
      }
      return results;
    },

    async findServiceVisitById(id) {
      const { data, error } = await supabase.from("service_visits").select().eq("id", id).maybeSingle();
      if (error) throw new Error(`[scheduling] service_visits lookup failed: ${error.message}`);
      return data ? toServiceVisitRow(data) : null;
    },

    async findDirectServiceVisitByBookingOrderId(bookingOrderId) {
      const { data, error } = await supabase
        .from("service_visits")
        .select()
        .eq("booking_order_id", bookingOrderId)
        .is("recurring_schedule_id", null)
        .maybeSingle();
      if (error) throw new Error(`[scheduling] direct service_visits lookup failed: ${error.message}`);
      return data ? toServiceVisitRow(data) : null;
    },

    async listServiceVisitsForCustomer(customerId) {
      const { data, error } = await supabase
        .from("service_visits")
        .select()
        .eq("customer_id", customerId)
        .order("created_at", { ascending: false });
      if (error) throw new Error(`[scheduling] service_visits lookup for customer failed: ${error.message}`);
      return (data ?? []).map(toServiceVisitRow);
    },

    async insertServiceVisit(row: NewServiceVisitRow) {
      const { data, error } = await supabase
        .from("service_visits")
        .insert({
          customer_id: row.customerId,
          quote_request_id: row.quoteRequestId,
          booking_order_id: row.bookingOrderId,
          prepaid_package_id: row.prepaidPackageId,
          recurring_schedule_id: row.recurringScheduleId,
          visit_number: row.visitNumber,
          cleaning_type: row.cleaningType,
          frequency: row.frequency,
          status: "requested",
          requested_start_at: row.requestedStartAt?.toISOString() ?? null,
          timezone: row.timezone,
          service_address_line1: row.serviceAddressLine1,
          service_address_line2: row.serviceAddressLine2,
          service_city: row.serviceCity,
          service_state: row.serviceState,
          service_address_identity: row.serviceAddressIdentity,
        })
        .select()
        .single();
      if (error || !data) throw new Error(`[scheduling] service_visits insert failed: ${error?.message ?? "no row returned"}`);
      return toServiceVisitRow(data);
    },

    async updateServiceVisitRequestedStart(serviceVisitId, requestedStartAt) {
      const { error } = await supabase
        .from("service_visits")
        .update({ requested_start_at: requestedStartAt.toISOString() })
        .eq("id", serviceVisitId);
      if (error) throw new Error(`[scheduling] service_visits requested_start_at update failed: ${error.message}`);
    },

    async setServiceVisitSchedule(params) {
      const { error } = await supabase.rpc("set_service_visit_schedule", {
        p_service_visit_id: params.serviceVisitId,
        p_confirmed_start_at: params.confirmedStartAt.toISOString(),
        p_confirmed_end_at: params.confirmedEndAt.toISOString(),
        p_estimated_labor_minutes: params.estimatedLaborMinutes,
        p_estimated_service_minutes: params.estimatedServiceMinutes,
        p_recommended_cleaner_count: params.recommendedCleanerCount,
        p_turnaround_buffer_minutes: params.turnaroundBufferMinutes,
        p_cleaner_ids: params.cleanerIds,
      });
      if (error) {
        if (isExclusionViolation(error)) throw new SchedulingConflictError();
        throw new Error(`[scheduling] set_service_visit_schedule failed: ${error.message}`);
      }
    },

    async completeServiceVisitRpc(serviceVisitId) {
      const { error } = await supabase.rpc("complete_service_visit", { p_service_visit_id: serviceVisitId });
      if (error) throw new Error(`[scheduling] complete_service_visit failed: ${error.message}`);
    },

    async markServiceVisitWorkFinishedRpc(serviceVisitId) {
      const { error } = await supabase.rpc("mark_service_visit_work_finished", { p_service_visit_id: serviceVisitId });
      if (error) throw new Error(`[scheduling] mark_service_visit_work_finished failed: ${error.message}`);
    },

    async cancelServiceVisit(serviceVisitId) {
      const { data, error } = await supabase
        .from("service_visits")
        .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
        .eq("id", serviceVisitId)
        .not("status", "in", "(completed,cancelled)")
        .select("id");
      if (error) throw new Error(`[scheduling] service_visits cancel failed: ${error.message}`);
      const changed = (data ?? []).length > 0;
      if (changed) {
        const { error: unassignError } = await supabase
          .from("service_visit_assignments")
          .update({ unassigned_at: new Date().toISOString() })
          .eq("service_visit_id", serviceVisitId)
          .is("unassigned_at", null);
        if (unassignError) throw new Error(`[scheduling] releasing assignments on cancel failed: ${unassignError.message}`);
      }
      return changed;
    },

    async setReviewRequestSuppressed(serviceVisitId, suppressed) {
      const { error } = await supabase.from("service_visits").update({ review_request_suppressed: suppressed }).eq("id", serviceVisitId);
      if (error) throw new Error(`[scheduling] setting review_request_suppressed failed: ${error.message}`);
    },

    async waiveServiceFeeAssessmentWithAudit(id, reason, audit) {
      // Single atomic Postgres RPC — see its migration for why this
      // replaced a two-step application-level read-then-update (which also
      // had no guard against re-waiving an already-waived/paid/void row)
      // with one transaction that also writes the required
      // financial_audit_log actor-attribution row.
      const { data, error } = await supabase.rpc("waive_service_fee_assessment_with_audit", {
        p_fee_assessment_id: id,
        p_reason: reason,
        p_actor_admin_user_id: audit.actorAdminUserId,
        p_actor_role: audit.actorRole,
      });
      if (error) {
        // Same convention as set_service_visit_schedule's exclusion_violation
        // translation below: a known, domain-meaningful RPC exception is
        // translated to a typed error the caller can present cleanly;
        // anything else (a genuine DB/network failure) stays a generic Error.
        if (/not found|not eligible for waiver|a reason is required/i.test(error.message ?? "")) {
          throw new InvalidVisitStateError(error.message);
        }
        throw new Error(`[scheduling] waive_service_fee_assessment_with_audit failed: ${error.message}`);
      }
      return {
        id: data.id,
        serviceVisitId: data.service_visit_id,
        feeType: data.fee_type,
        amount: Number(data.amount),
        policyVersion: data.policy_version,
        reason: data.reason,
        state: data.state,
      };
    },

    async collectServiceFeeAssessmentWithAudit(id, patch, audit) {
      const { data, error } = await supabase.rpc("collect_service_fee_assessment_with_audit", {
        p_fee_assessment_id: id,
        p_collection_method: patch.collectionMethod,
        p_external_payment_reference: patch.externalPaymentReference,
        p_stripe_payment_intent_id: patch.stripePaymentIntentId,
        p_actor_admin_user_id: audit.actorAdminUserId,
        p_actor_role: audit.actorRole,
      });
      if (error) {
        if (/not found|not eligible for collection|invalid p_collection_method/i.test(error.message ?? "")) {
          throw new InvalidVisitStateError(error.message);
        }
        throw new Error(`[scheduling] collect_service_fee_assessment_with_audit failed: ${error.message}`);
      }
      return {
        id: data.id,
        serviceVisitId: data.service_visit_id,
        feeType: data.fee_type,
        amount: Number(data.amount),
        policyVersion: data.policy_version,
        reason: data.reason,
        state: data.state,
        collectionMethod: data.collection_method,
        externalPaymentReference: data.external_payment_reference,
        stripePaymentIntentId: data.stripe_payment_intent_id,
        collectedAt: data.collected_at ? new Date(data.collected_at) : null,
      };
    },

    async insertServiceVisitEvent(row) {
      const { error } = await supabase.from("service_visit_events").insert({
        service_visit_id: row.serviceVisitId,
        event_type: row.eventType,
        actor: row.actor,
        previous_state: row.previousState,
        new_state: row.newState,
        notes: row.notes,
      });
      if (error) throw new Error(`[scheduling] service_visit_events insert failed: ${error.message}`);
    },

    async insertServiceFeeAssessment(row: NewServiceFeeAssessmentRow) {
      const { data, error } = await supabase
        .from("service_fee_assessments")
        .insert({
          service_visit_id: row.serviceVisitId,
          fee_type: row.feeType,
          amount: row.amount,
          policy_version: row.policyVersion,
          reason: row.reason,
        })
        .select()
        .single();
      if (error || !data) throw new Error(`[scheduling] service_fee_assessments insert failed: ${error?.message ?? "no row returned"}`);
      return {
        id: data.id,
        serviceVisitId: data.service_visit_id,
        feeType: data.fee_type,
        amount: Number(data.amount),
        policyVersion: data.policy_version,
        reason: data.reason,
        state: data.state,
      } satisfies ServiceFeeAssessmentRow;
    },

    async insertServiceVisitNotification(row: NewServiceVisitNotificationRow) {
      const { data, error } = await supabase
        .from("service_visit_notifications")
        .upsert(
          {
            service_visit_id: row.serviceVisitId,
            customer_id: row.customerId,
            notification_type: row.notificationType,
            channel: row.channel,
            scheduled_send_at: row.scheduledSendAt.toISOString(),
            idempotency_key: row.idempotencyKey,
          },
          { onConflict: "idempotency_key", ignoreDuplicates: true }
        )
        .select("id")
        .maybeSingle();
      if (error) throw new Error(`[scheduling] service_visit_notifications insert failed: ${error.message}`);
      return { inserted: Boolean(data) };
    },

    async cancelPendingServiceVisitNotifications(serviceVisitId) {
      // Scoped to reminder_24h specifically (matches this function's actual
      // intent, "cancel the stale pending REMINDER") — must never collide
      // with a same-visit, same-moment one-off notice like
      // appointment_confirmed/rescheduled enqueued in the same call, which
      // is a real, wanted pending row, not a stale reminder to discard.
      const { error } = await supabase
        .from("service_visit_notifications")
        .update({ state: "cancelled" })
        .eq("service_visit_id", serviceVisitId)
        .eq("notification_type", "reminder_24h")
        .eq("state", "pending");
      if (error) throw new Error(`[scheduling] cancelling pending notifications failed: ${error.message}`);
    },

    async listServiceVisitNotifications(serviceVisitId) {
      const { data, error } = await supabase
        .from("service_visit_notifications")
        .select()
        .eq("service_visit_id", serviceVisitId)
        .order("scheduled_send_at", { ascending: false });
      if (error) throw new Error(`[scheduling] service_visit_notifications lookup failed: ${error.message}`);
      return (data ?? []).map(toServiceVisitNotificationRow);
    },

    async findServiceVisitNotificationById(id) {
      const { data, error } = await supabase.from("service_visit_notifications").select().eq("id", id).maybeSingle();
      if (error) throw new Error(`[scheduling] service_visit_notifications lookup by id failed: ${error.message}`);
      return data ? toServiceVisitNotificationRow(data) : null;
    },

    async claimDueServiceVisitNotifications(limit, staleMinutes) {
      const { data, error } = await supabase.rpc("claim_due_service_visit_notifications", {
        p_limit: limit,
        p_stale_minutes: staleMinutes,
      });
      if (error) throw new Error(`[scheduling] claim_due_service_visit_notifications failed: ${error.message}`);
      return ((data ?? []) as Record<string, unknown>[]).map(toServiceVisitNotificationRow);
    },

    async markServiceVisitNotificationSent(id, providerMessageId) {
      const { error } = await supabase
        .from("service_visit_notifications")
        .update({ state: "sent", sent_at: new Date().toISOString(), provider_message_id: providerMessageId, claimed_at: null })
        .eq("id", id)
        .eq("state", "sending");
      if (error) throw new Error(`[scheduling] marking service_visit_notification sent failed: ${error.message}`);
    },

    async markServiceVisitNotificationRetry(id, params) {
      const { data: current, error: fetchError } = await supabase
        .from("service_visit_notifications")
        .select("retry_count")
        .eq("id", id)
        .single();
      if (fetchError || !current) throw new Error(`[scheduling] service_visit_notifications lookup before retry failed: ${fetchError?.message}`);
      const { error } = await supabase
        .from("service_visit_notifications")
        .update({
          state: "pending",
          retry_count: (current.retry_count as number) + 1,
          failure_reason: params.failureReason,
          scheduled_send_at: params.nextScheduledSendAt.toISOString(),
          claimed_at: null,
        })
        .eq("id", id)
        .eq("state", "sending");
      if (error) throw new Error(`[scheduling] marking service_visit_notification retry failed: ${error.message}`);
    },

    async markServiceVisitNotificationFailedTerminal(id, failureReason) {
      const { data: current, error: fetchError } = await supabase
        .from("service_visit_notifications")
        .select("retry_count")
        .eq("id", id)
        .single();
      if (fetchError || !current) throw new Error(`[scheduling] service_visit_notifications lookup before terminal failure failed: ${fetchError?.message}`);
      const { error } = await supabase
        .from("service_visit_notifications")
        .update({ state: "failed", retry_count: (current.retry_count as number) + 1, failure_reason: failureReason, claimed_at: null })
        .eq("id", id)
        .eq("state", "sending");
      if (error) throw new Error(`[scheduling] marking service_visit_notification failed (terminal) failed: ${error.message}`);
    },

    async retryFailedServiceVisitNotification(id) {
      const { error } = await supabase
        .from("service_visit_notifications")
        .update({ state: "pending", retry_count: 0, scheduled_send_at: new Date().toISOString(), claimed_at: null })
        .eq("id", id)
        .eq("state", "failed");
      if (error) throw new Error(`[scheduling] retrying failed service_visit_notification failed: ${error.message}`);
    },

    async cancelPendingConsentReminderForVisit(serviceVisitId) {
      const { error } = await supabase
        .from("service_visit_notifications")
        .update({ state: "cancelled" })
        .eq("service_visit_id", serviceVisitId)
        .eq("notification_type", "consent_reminder")
        .eq("state", "pending");
      if (error) throw new Error(`[scheduling] cancelling pending consent_reminder for visit failed: ${error.message}`);
    },

    async cancelPendingConsentRemindersForCustomer(customerId) {
      const { error } = await supabase
        .from("service_visit_notifications")
        .update({ state: "cancelled" })
        .eq("customer_id", customerId)
        .eq("notification_type", "consent_reminder")
        .eq("state", "pending");
      if (error) throw new Error(`[scheduling] cancelling pending consent_reminders for customer failed: ${error.message}`);
    },

    async findMostRecentSentReviewRequestAt(customerId) {
      const { data, error } = await supabase
        .from("service_visit_notifications")
        .select("sent_at")
        .eq("customer_id", customerId)
        .eq("notification_type", "review_request")
        .eq("state", "sent")
        .order("sent_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(`[scheduling] most-recent-sent review_request lookup failed: ${error.message}`);
      return data?.sent_at ? new Date(data.sent_at as string) : null;
    },

    async insertRecurringSchedule(row: NewRecurringScheduleRow) {
      const { data, error } = await supabase
        .from("recurring_schedules")
        .insert({
          customer_id: row.customerId,
          booking_order_id: row.bookingOrderId,
          prepaid_package_id: row.prepaidPackageId,
          cadence: row.cadence,
          preferred_day_of_week: row.preferredDayOfWeek,
          preferred_start_time: row.preferredStartTime,
          timezone: row.timezone,
          effective_from: row.effectiveFrom,
          supersedes_id: row.supersedesId,
        })
        .select()
        .single();
      if (error || !data) throw new Error(`[scheduling] recurring_schedules insert failed: ${error?.message ?? "no row returned"}`);
      return toRecurringScheduleRow(data);
    },

    async findRecurringScheduleById(id) {
      const { data, error } = await supabase.from("recurring_schedules").select().eq("id", id).maybeSingle();
      if (error) throw new Error(`[scheduling] recurring_schedules lookup by id failed: ${error.message}`);
      return data ? toRecurringScheduleRow(data) : null;
    },

    async findActiveRecurringScheduleForBookingOrder(bookingOrderId) {
      const { data, error } = await supabase
        .from("recurring_schedules")
        .select()
        .eq("booking_order_id", bookingOrderId)
        .eq("status", "active")
        .maybeSingle();
      if (error) throw new Error(`[scheduling] recurring_schedules lookup by booking order failed: ${error.message}`);
      return data ? toRecurringScheduleRow(data) : null;
    },

    async findActiveRecurringScheduleForPackage(prepaidPackageId) {
      const { data, error } = await supabase
        .from("recurring_schedules")
        .select()
        .eq("prepaid_package_id", prepaidPackageId)
        .eq("status", "active")
        .maybeSingle();
      if (error) throw new Error(`[scheduling] recurring_schedules lookup by package failed: ${error.message}`);
      return data ? toRecurringScheduleRow(data) : null;
    },

    async supersedeRecurringSchedule(id, effectiveUntil) {
      const { error } = await supabase
        .from("recurring_schedules")
        .update({ status: "superseded", effective_until: effectiveUntil })
        .eq("id", id);
      if (error) throw new Error(`[scheduling] superseding recurring_schedules failed: ${error.message}`);
    },

    async findPrepaidPackageById(id) {
      const { data, error } = await supabase
        .from("prepaid_packages")
        .select(
          "id,customer_id,booking_order_id,frequency,purchased_visit_count,remaining_visit_count,package_total_paid,tax_amount,total_amount_paid,stripe_tax_transaction_id,effective_price_per_visit,status,purchased_at,refunded_amount,refunded_tax_amount,total_refunded_amount,refunded_at,cancelled_at,cancellation_reason"
        )
        .eq("id", id)
        .maybeSingle();
      if (error) throw new Error(`[scheduling] prepaid_packages lookup failed: ${error.message}`);
      return data ? toPrepaidPackageRow(data) : null;
    },

    async findPrepaidPackageByBookingOrderId(bookingOrderId) {
      const { data, error } = await supabase
        .from("prepaid_packages")
        .select(
          "id,customer_id,booking_order_id,frequency,purchased_visit_count,remaining_visit_count,package_total_paid,tax_amount,total_amount_paid,stripe_tax_transaction_id,effective_price_per_visit,status,purchased_at,refunded_amount,refunded_tax_amount,total_refunded_amount,refunded_at,cancelled_at,cancellation_reason"
        )
        .eq("booking_order_id", bookingOrderId)
        .maybeSingle();
      if (error) throw new Error(`[scheduling] prepaid_packages lookup by booking_order_id failed: ${error.message}`);
      return data ? toPrepaidPackageRow(data) : null;
    },

    async findActivePrepaidPackageForCustomer(customerId) {
      const { data, error } = await supabase
        .from("prepaid_packages")
        .select(
          "id,customer_id,booking_order_id,frequency,purchased_visit_count,remaining_visit_count,package_total_paid,tax_amount,total_amount_paid,stripe_tax_transaction_id,effective_price_per_visit,status,purchased_at,refunded_amount,refunded_tax_amount,total_refunded_amount,refunded_at,cancelled_at,cancellation_reason"
        )
        .eq("customer_id", customerId)
        .eq("status", "active")
        .gt("remaining_visit_count", 0)
        .order("purchased_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(`[scheduling] active prepaid_packages lookup for customer failed: ${error.message}`);
      return data ? toPrepaidPackageRow(data) : null;
    },

    async cancelPrepaidPackageWithRefundAudit(id, patch, audit) {
      const { data, error } = await supabase.rpc("cancel_prepaid_package_with_refund_audit", {
        p_prepaid_package_id: id,
        p_refund_amount: patch.refundAmount,
        p_refund_tax_amount: patch.refundTaxAmount,
        p_total_refund_amount: patch.totalRefundAmount,
        p_stripe_refund_id: patch.stripeRefundId,
        p_actor_admin_user_id: audit.actorAdminUserId,
        p_actor_role: audit.actorRole,
        p_reason: patch.reason,
      });
      if (error) throw new Error(`[scheduling] cancel_prepaid_package_with_refund_audit failed: ${error.message}`);
      return toPrepaidPackageRow(data);
    },

    async listActiveRecurringSchedulesForCustomer(customerId) {
      const { data, error } = await supabase
        .from("recurring_schedules")
        .select()
        .eq("customer_id", customerId)
        .eq("status", "active");
      if (error) throw new Error(`[scheduling] active recurring_schedules lookup for customer failed: ${error.message}`);
      return (data ?? []).map(toRecurringScheduleRow);
    },

    async listPackageVisitPlans(prepaidPackageId) {
      const { data, error } = await supabase
        .from("package_visit_plans")
        .select()
        .eq("prepaid_package_id", prepaidPackageId)
        .order("visit_number", { ascending: true });
      if (error) throw new Error(`[scheduling] package_visit_plans lookup failed: ${error.message}`);
      return (data ?? []).map(toPackageVisitPlanRow);
    },

    async findPackageVisitPlanById(id) {
      const { data, error } = await supabase.from("package_visit_plans").select().eq("id", id).maybeSingle();
      if (error) throw new Error(`[scheduling] package_visit_plans lookup by id failed: ${error.message}`);
      return data ? toPackageVisitPlanRow(data) : null;
    },

    async findPackageVisitPlanByRecurringVisitPlanId(recurringVisitPlanId) {
      const { data, error } = await supabase
        .from("package_visit_plans")
        .select()
        .eq("recurring_visit_plan_id", recurringVisitPlanId)
        .maybeSingle();
      if (error) throw new Error(`[scheduling] package_visit_plans lookup by recurring_visit_plan_id failed: ${error.message}`);
      return data ? toPackageVisitPlanRow(data) : null;
    },

    async insertPackageVisitPlan(row: NewPackageVisitPlanRow) {
      const { data: inserted, error: insertError } = await supabase
        .from("package_visit_plans")
        .upsert(
          {
            prepaid_package_id: row.prepaidPackageId,
            visit_number: row.visitNumber,
            planned_date: row.plannedDate,
            planned_start_time: row.plannedStartTime,
            generated_from_recurring_schedule_id: row.generatedFromRecurringScheduleId,
          },
          { onConflict: "prepaid_package_id,visit_number", ignoreDuplicates: true }
        )
        .select()
        .maybeSingle();
      if (insertError) throw new Error(`[scheduling] package_visit_plans insert failed: ${insertError.message}`);
      if (inserted) {
        return { plan: toPackageVisitPlanRow(inserted), inserted: true };
      }
      const { data: existing, error: fetchError } = await supabase
        .from("package_visit_plans")
        .select()
        .eq("prepaid_package_id", row.prepaidPackageId)
        .eq("visit_number", row.visitNumber)
        .single();
      if (fetchError || !existing) {
        throw new Error(`[scheduling] package_visit_plans fetch-after-conflict failed: ${fetchError?.message ?? "no row found"}`);
      }
      return { plan: toPackageVisitPlanRow(existing), inserted: false };
    },

    async updatePackageVisitPlan(id, patch) {
      const dbPatch: Record<string, unknown> = {};
      if (patch.plannedDate !== undefined) dbPatch.planned_date = patch.plannedDate;
      if (patch.plannedStartTime !== undefined) dbPatch.planned_start_time = patch.plannedStartTime;
      if (patch.status !== undefined) dbPatch.status = patch.status;
      if (patch.serviceVisitId !== undefined) dbPatch.service_visit_id = patch.serviceVisitId;
      if (patch.recurringVisitPlanId !== undefined) dbPatch.recurring_visit_plan_id = patch.recurringVisitPlanId;
      const { error } = await supabase.from("package_visit_plans").update(dbPatch).eq("id", id);
      if (error) throw new Error(`[scheduling] package_visit_plans update failed: ${error.message}`);
    },

    async insertPackageVisitPlanHistory(row: NewPackageVisitPlanHistoryRow) {
      const { error } = await supabase.from("package_visit_plan_history").insert({
        package_visit_plan_id: row.packageVisitPlanId,
        prepaid_package_id: row.prepaidPackageId,
        visit_number: row.visitNumber,
        previous_planned_date: row.previousPlannedDate,
        previous_planned_start_time: row.previousPlannedStartTime,
        previous_status: row.previousStatus,
        new_planned_date: row.newPlannedDate,
        new_planned_start_time: row.newPlannedStartTime,
        new_status: row.newStatus,
        change_reason: row.changeReason,
        package_amendment_id: row.packageAmendmentId,
      });
      if (error) throw new Error(`[scheduling] package_visit_plan_history insert failed: ${error.message}`);
    },

    async insertPackageAmendment(row: NewPackageAmendmentRow) {
      const valueDifference = row.valueDifference;
      const paymentState =
        valueDifference > 0 ? "additional_payment_pending" : valueDifference < 0 ? "refund_pending" : "not_required";
      const { data, error } = await supabase
        .from("package_amendments")
        .insert({
          prepaid_package_id: row.prepaidPackageId,
          old_cadence: row.oldCadence,
          new_cadence: row.newCadence,
          effective_from_visit_number: row.effectiveFromVisitNumber,
          remaining_visit_count_at_amendment: row.remainingVisitCountAtAmendment,
          old_remaining_value: row.oldRemainingValue,
          new_remaining_value: row.newRemainingValue,
          value_difference: row.valueDifference,
          pricing_snapshot: row.pricingSnapshot,
          reason: row.reason,
          payment_state: paymentState,
          initiated_by_note: row.initiatedByNote,
        })
        .select()
        .single();
      if (error || !data) throw new Error(`[scheduling] package_amendments insert failed: ${error?.message ?? "no row returned"}`);
      return toPackageAmendmentRow(data);
    },

    async findPackageAmendmentById(id) {
      const { data, error } = await supabase.from("package_amendments").select().eq("id", id).maybeSingle();
      if (error) throw new Error(`[scheduling] package_amendments lookup failed: ${error.message}`);
      return data ? toPackageAmendmentRow(data) : null;
    },

    async updatePackageAmendmentState(id, patch) {
      const dbPatch: Record<string, unknown> = {};
      if (patch.approvalState !== undefined) dbPatch.approval_state = patch.approvalState;
      if (patch.paymentState !== undefined) dbPatch.payment_state = patch.paymentState;
      const { data, error } = await supabase.from("package_amendments").update(dbPatch).eq("id", id).select().maybeSingle();
      if (error) throw new Error(`[scheduling] package_amendments state update failed: ${error.message}`);
      return data ? toPackageAmendmentRow(data) : null;
    },

    async listRecurringVisitPlans(recurringScheduleId) {
      const { data, error } = await supabase
        .from("recurring_visit_plans")
        .select()
        .eq("recurring_schedule_id", recurringScheduleId)
        .order("visit_number", { ascending: true });
      if (error) throw new Error(`[scheduling] recurring_visit_plans lookup failed: ${error.message}`);
      return (data ?? []).map(toRecurringVisitPlanRow);
    },

    async findRecurringVisitPlanById(id) {
      const { data, error } = await supabase.from("recurring_visit_plans").select().eq("id", id).maybeSingle();
      if (error) throw new Error(`[scheduling] recurring_visit_plans lookup by id failed: ${error.message}`);
      return data ? toRecurringVisitPlanRow(data) : null;
    },

    async findRecurringVisitPlanByServiceVisitId(serviceVisitId) {
      const { data, error } = await supabase.from("recurring_visit_plans").select().eq("service_visit_id", serviceVisitId).maybeSingle();
      if (error) throw new Error(`[scheduling] recurring_visit_plans lookup by service_visit_id failed: ${error.message}`);
      return data ? toRecurringVisitPlanRow(data) : null;
    },

    async insertRecurringVisitPlan(row: NewRecurringVisitPlanRow) {
      const { data: inserted, error: insertError } = await supabase
        .from("recurring_visit_plans")
        .upsert(
          {
            recurring_schedule_id: row.recurringScheduleId,
            customer_id: row.customerId,
            visit_number: row.visitNumber,
            planned_date: row.plannedDate,
            planned_start_time: row.plannedStartTime,
          },
          { onConflict: "recurring_schedule_id,visit_number", ignoreDuplicates: true }
        )
        .select()
        .maybeSingle();
      if (insertError) throw new Error(`[scheduling] recurring_visit_plans insert failed: ${insertError.message}`);
      if (inserted) {
        return { plan: toRecurringVisitPlanRow(inserted), inserted: true };
      }
      const { data: existing, error: fetchError } = await supabase
        .from("recurring_visit_plans")
        .select()
        .eq("recurring_schedule_id", row.recurringScheduleId)
        .eq("visit_number", row.visitNumber)
        .single();
      if (fetchError || !existing) {
        throw new Error(`[scheduling] recurring_visit_plans fetch-after-conflict failed: ${fetchError?.message ?? "no row found"}`);
      }
      return { plan: toRecurringVisitPlanRow(existing), inserted: false };
    },

    async updateRecurringVisitPlan(id, patch) {
      const dbPatch: Record<string, unknown> = {};
      if (patch.plannedDate !== undefined) dbPatch.planned_date = patch.plannedDate;
      if (patch.plannedStartTime !== undefined) dbPatch.planned_start_time = patch.plannedStartTime;
      if (patch.status !== undefined) dbPatch.status = patch.status;
      if (patch.serviceVisitId !== undefined) dbPatch.service_visit_id = patch.serviceVisitId;
      if (patch.recurringScheduleId !== undefined) dbPatch.recurring_schedule_id = patch.recurringScheduleId;
      const { error } = await supabase.from("recurring_visit_plans").update(dbPatch).eq("id", id);
      if (error) throw new Error(`[scheduling] recurring_visit_plans update failed: ${error.message}`);
    },

    async insertRecurringVisitPlanHistory(row: NewRecurringVisitPlanHistoryRow) {
      const { error } = await supabase.from("recurring_visit_plan_history").insert({
        recurring_visit_plan_id: row.recurringVisitPlanId,
        recurring_schedule_id: row.recurringScheduleId,
        visit_number: row.visitNumber,
        previous_planned_date: row.previousPlannedDate,
        previous_planned_start_time: row.previousPlannedStartTime,
        previous_status: row.previousStatus,
        new_planned_date: row.newPlannedDate,
        new_planned_start_time: row.newPlannedStartTime,
        new_status: row.newStatus,
        change_reason: row.changeReason,
      });
      if (error) throw new Error(`[scheduling] recurring_visit_plan_history insert failed: ${error.message}`);
    },

    async findActiveRecurringScopeVersion(recurringScheduleId) {
      const { data, error } = await supabase
        .from("recurring_scope_versions")
        .select()
        .eq("recurring_schedule_id", recurringScheduleId)
        .eq("status", "active")
        .maybeSingle();
      if (error) throw new Error(`[scheduling] active recurring_scope_versions lookup failed: ${error.message}`);
      return data ? toRecurringScopeVersionRow(data) : null;
    },

    async findRecurringScopeVersionById(id) {
      const { data, error } = await supabase.from("recurring_scope_versions").select().eq("id", id).maybeSingle();
      if (error) throw new Error(`[scheduling] recurring_scope_versions lookup by id failed: ${error.message}`);
      return data ? toRecurringScopeVersionRow(data) : null;
    },

    async insertRecurringScopeVersion(row: NewRecurringScopeVersionRow) {
      const { data, error } = await supabase
        .from("recurring_scope_versions")
        .insert({
          recurring_schedule_id: row.recurringScheduleId,
          customer_id: row.customerId,
          base_calculation_input: row.baseCalculationInput,
          approved_base_amount: row.approvedBaseAmount,
          pricing_snapshot: row.pricingSnapshot,
          effective_from_visit_number: row.effectiveFromVisitNumber,
          supersedes_id: row.supersedesId,
          requested_by: row.requestedBy,
          reason: row.reason,
        })
        .select()
        .single();
      if (error || !data) throw new Error(`[scheduling] recurring_scope_versions insert failed: ${error?.message ?? "no row returned"}`);
      return toRecurringScopeVersionRow(data);
    },

    async supersedeRecurringScopeVersion(id) {
      const { error } = await supabase.from("recurring_scope_versions").update({ status: "superseded" }).eq("id", id);
      if (error) throw new Error(`[scheduling] superseding recurring_scope_versions failed: ${error.message}`);
    },

    async updateRecurringScopeVersionStatus(id, status) {
      const { data, error } = await supabase.from("recurring_scope_versions").update({ status }).eq("id", id).select().maybeSingle();
      if (error) throw new Error(`[scheduling] recurring_scope_versions status update failed: ${error.message}`);
      return data ? toRecurringScopeVersionRow(data) : null;
    },

    async findServiceVisitPricingByVisitId(serviceVisitId) {
      const { data, error } = await supabase
        .from("service_visit_pricing")
        .select()
        .eq("service_visit_id", serviceVisitId)
        .maybeSingle();
      if (error) throw new Error(`[scheduling] service_visit_pricing lookup failed: ${error.message}`);
      return data ? toServiceVisitPricingRow(data) : null;
    },

    async upsertServiceVisitPricing(row: NewServiceVisitPricingRow) {
      const { data, error } = await supabase
        .from("service_visit_pricing")
        .upsert(
          {
            service_visit_id: row.serviceVisitId,
            pricing_version: row.pricingVersion,
            pricing_snapshot: row.pricingSnapshot,
            base_amount: row.baseAmount,
            add_on_ids: row.addOnIds,
            add_on_amount: row.addOnAmount,
            total_amount: row.totalAmount,
            amount_due_from_customer: row.amountDueFromCustomer,
            price_status: row.priceStatus,
            requires_customer_approval: row.requiresCustomerApproval,
            previously_approved_amount: row.previouslyApprovedAmount,
          },
          { onConflict: "service_visit_id" }
        )
        .select()
        .single();
      if (error || !data) throw new Error(`[scheduling] service_visit_pricing upsert failed: ${error?.message ?? "no row returned"}`);
      return toServiceVisitPricingRow(data);
    },

    async confirmServiceVisitPricing(serviceVisitId, confirmedBy) {
      const { data: existing, error: fetchError } = await supabase
        .from("service_visit_pricing")
        .select()
        .eq("service_visit_id", serviceVisitId)
        .maybeSingle();
      if (fetchError) throw new Error(`[scheduling] service_visit_pricing lookup before confirm failed: ${fetchError.message}`);
      if (!existing) return null;

      const nextPaymentStatus = Number(existing.amount_due_from_customer) > 0 ? "awaiting_completion" : "not_applicable";

      const { data, error } = await supabase
        .from("service_visit_pricing")
        .update({
          price_status: "confirmed",
          previously_approved_amount: existing.total_amount,
          requires_customer_approval: false,
          payment_status: nextPaymentStatus,
          confirmed_at: new Date().toISOString(),
          confirmed_by: confirmedBy,
        })
        .eq("service_visit_id", serviceVisitId)
        .select()
        .maybeSingle();
      if (error) throw new Error(`[scheduling] service_visit_pricing confirm failed: ${error.message}`);
      return data ? toServiceVisitPricingRow(data) : null;
    },

    async updateServiceVisitPricingPaymentStatus(serviceVisitId, paymentStatus) {
      const { data, error } = await supabase
        .from("service_visit_pricing")
        .update({ payment_status: paymentStatus })
        .eq("service_visit_id", serviceVisitId)
        .select()
        .maybeSingle();
      if (error) throw new Error(`[scheduling] service_visit_pricing payment_status update failed: ${error.message}`);
      return data ? toServiceVisitPricingRow(data) : null;
    },

    async findServiceVisitPaymentByVisitId(serviceVisitId) {
      const { data, error } = await supabase.from("service_visit_payments").select().eq("service_visit_id", serviceVisitId).maybeSingle();
      if (error) throw new Error(`[scheduling] service_visit_payments lookup failed: ${error.message}`);
      return data ? toServiceVisitPaymentRow(data) : null;
    },

    async findServiceVisitPaymentById(id) {
      const { data, error } = await supabase.from("service_visit_payments").select().eq("id", id).maybeSingle();
      if (error) throw new Error(`[scheduling] service_visit_payments lookup by id failed: ${error.message}`);
      return data ? toServiceVisitPaymentRow(data) : null;
    },

    async findServiceVisitPaymentByStripePaymentIntentId(stripePaymentIntentId) {
      const { data, error } = await supabase.from("service_visit_payments").select().eq("stripe_payment_intent_id", stripePaymentIntentId).maybeSingle();
      if (error) throw new Error(`[scheduling] service_visit_payments lookup by PaymentIntent id failed: ${error.message}`);
      return data ? toServiceVisitPaymentRow(data) : null;
    },

    async insertServiceVisitPaymentAttempt(row: NewServiceVisitPaymentRow) {
      const { data, error } = await supabase
        .from("service_visit_payments")
        .upsert(
          {
            service_visit_id: row.serviceVisitId,
            service_visit_pricing_id: row.serviceVisitPricingId,
            approved_amount: row.approvedAmount,
            idempotency_key: row.idempotencyKey,
          },
          { onConflict: "service_visit_id", ignoreDuplicates: true }
        )
        .select()
        .maybeSingle();
      if (error) throw new Error(`[scheduling] service_visit_payments insert failed: ${error.message}`);
      if (data) return { inserted: true, record: toServiceVisitPaymentRow(data) };

      const existing = await supabase.from("service_visit_payments").select().eq("service_visit_id", row.serviceVisitId).single();
      if (existing.error || !existing.data) throw new Error(`[scheduling] service_visit_payments lookup after conflict failed: ${existing.error?.message}`);
      return { inserted: false, record: toServiceVisitPaymentRow(existing.data) };
    },

    async updateServiceVisitPaymentTip(id: string, patch: ServiceVisitPaymentTipPatch) {
      const { data, error } = await supabase
        .from("service_visit_payments")
        .update({
          tip_basis_amount: patch.tipBasisAmount,
          tip_selection_type: patch.tipSelectionType,
          tip_percentage: patch.tipPercentage,
          tip_amount: patch.tipAmount,
          tax_amount: patch.taxAmount,
          total_amount: patch.totalAmount,
          stripe_tax_calculation_id: patch.stripeTaxCalculationId,
          tax_calculation_expires_at: patch.taxCalculationExpiresAt,
          tax_location_snapshot: patch.taxLocationSnapshot,
          tip_selected_at: new Date().toISOString(),
        })
        .eq("id", id)
        .is("tip_confirmed_at", null)
        .select()
        .maybeSingle();
      if (error) throw new Error(`[scheduling] service_visit_payments tip update failed: ${error.message}`);
      if (!data) throw new Error(`[scheduling] service_visit_payments ${id} is already frozen (tip_confirmed_at is set) — cannot update tip`);
      return toServiceVisitPaymentRow(data);
    },

    async freezeServiceVisitPaymentForStripeCard(id: string, patch: ServiceVisitPaymentStripeCardFreezePatch) {
      const { data, error } = await supabase
        .from("service_visit_payments")
        .update({
          payment_method_type: "stripe_card",
          stripe_customer_id: patch.stripeCustomerId,
          stripe_payment_method_id: patch.stripePaymentMethodId,
          card_brand: patch.cardBrand,
          card_last4: patch.cardLast4,
          tip_confirmed_at: new Date().toISOString(),
        })
        .eq("id", id)
        .is("tip_confirmed_at", null)
        .select()
        .maybeSingle();
      if (error) throw new Error(`[scheduling] service_visit_payments stripe-card freeze failed: ${error.message}`);
      if (!data) throw new Error(`[scheduling] service_visit_payments ${id} is already frozen — cannot freeze again`);
      return toServiceVisitPaymentRow(data);
    },

    async freezeServiceVisitPaymentAsNoPaymentDue(id: string) {
      const { data, error } = await supabase
        .from("service_visit_payments")
        .update({ status: "no_payment_due", tip_confirmed_at: new Date().toISOString() })
        .eq("id", id)
        .is("tip_confirmed_at", null)
        .select()
        .maybeSingle();
      if (error) throw new Error(`[scheduling] freezeServiceVisitPaymentAsNoPaymentDue failed: ${error.message}`);
      if (!data) throw new Error(`[scheduling] service_visit_payments ${id} is already frozen — cannot freeze again`);
      return toServiceVisitPaymentRow(data);
    },

    async setServiceVisitPaymentIntent(id: string, params: { stripePaymentIntentId: string; status: ServiceVisitPaymentRow["status"] }) {
      const { data, error } = await supabase
        .from("service_visit_payments")
        .update({ stripe_payment_intent_id: params.stripePaymentIntentId, status: params.status })
        .eq("id", id)
        .is("stripe_payment_intent_id", null)
        .select()
        .maybeSingle();
      if (error) throw new Error(`[scheduling] service_visit_payments setServiceVisitPaymentIntent failed: ${error.message}`);
      if (!data) throw new Error(`[scheduling] service_visit_payments ${id} already has a stripe_payment_intent_id`);
      return toServiceVisitPaymentRow(data);
    },

    async updateServiceVisitPaymentStatus(id: string, patch, allowedFromStatuses) {
      const update: Record<string, unknown> = { status: patch.status };
      if (patch.failureCode !== undefined) update.failure_code = patch.failureCode;
      if (patch.failureMessage !== undefined) update.failure_message = patch.failureMessage;
      if (patch.paidAt !== undefined) update.paid_at = patch.paidAt ? patch.paidAt.toISOString() : null;
      const { data, error } = await supabase
        .from("service_visit_payments")
        .update(update)
        .eq("id", id)
        .in("status", allowedFromStatuses as string[])
        .select()
        .maybeSingle();
      if (error) throw new Error(`[scheduling] service_visit_payments status update failed: ${error.message}`);
      return data ? toServiceVisitPaymentRow(data) : null;
    },

    async recordExternalServiceVisitPaymentWithAudit(
      id: string,
      patch: ServiceVisitPaymentExternalSettlementPatch,
      audit: { actorAdminUserId: string; actorRole: string }
    ) {
      // Single atomic Postgres RPC — see its migration for why this
      // replaced two separate application-level writes (the settlement
      // update and a separate financial_audit_log insert) that previously
      // left a window where a genuinely-paid visit could end up with no
      // audit row at all.
      const { data, error } = await supabase.rpc("record_external_visit_payment_with_audit", {
        p_service_visit_payment_id: id,
        p_payment_method_type: patch.paymentMethodType,
        p_external_payment_reference: patch.externalPaymentReference,
        p_actor_admin_user_id: audit.actorAdminUserId,
        p_actor_role: audit.actorRole,
      });
      if (error) throw new Error(`[scheduling] record_external_visit_payment_with_audit failed: ${error.message}`);
      return toServiceVisitPaymentRow(data);
    },

    async updateServiceVisitPaymentTaxSync(id: string, patch: ServiceVisitPaymentTaxSyncPatch) {
      const update: Record<string, unknown> = {
        tax_transaction_status: patch.taxTransactionStatus,
        tax_transaction_last_attempt_at: new Date().toISOString(),
      };
      if (patch.stripeTaxTransactionId !== undefined) update.stripe_tax_transaction_id = patch.stripeTaxTransactionId;
      if (patch.stripeTaxCalculationId !== undefined) update.stripe_tax_calculation_id = patch.stripeTaxCalculationId;
      if (patch.taxCalculationExpiresAt !== undefined) update.tax_calculation_expires_at = patch.taxCalculationExpiresAt ? patch.taxCalculationExpiresAt.toISOString() : null;
      if (patch.taxTransactionFailureCode !== undefined) update.tax_transaction_failure_code = patch.taxTransactionFailureCode;
      if (patch.taxTransactionFailureMessage !== undefined) update.tax_transaction_failure_message = patch.taxTransactionFailureMessage;
      const { data, error } = await supabase.from("service_visit_payments").update(update).eq("id", id).select().maybeSingle();
      if (error) throw new Error(`[scheduling] service_visit_payments tax-sync update failed: ${error.message}`);
      return data ? toServiceVisitPaymentRow(data) : null;
    },

    async updateServiceVisitPaymentRefund(id: string, patch: { refundedAmount: number; refundedAt: Date; status: "partially_refunded" | "refunded" }, allowedFromStatuses) {
      const { data, error } = await supabase
        .from("service_visit_payments")
        .update({ refunded_amount: patch.refundedAmount, refunded_at: patch.refundedAt.toISOString(), status: patch.status })
        .eq("id", id)
        .in("status", allowedFromStatuses as string[])
        .select()
        .maybeSingle();
      if (error) throw new Error(`[scheduling] service_visit_payments refund update failed: ${error.message}`);
      return data ? toServiceVisitPaymentRow(data) : null;
    },

    async refundServiceVisitPaymentWithAudit(id, patch, audit) {
      const { data, error } = await supabase.rpc("refund_visit_payment_with_audit", {
        p_service_visit_payment_id: id,
        p_refund_amount: patch.refundAmount,
        p_stripe_refund_id: patch.stripeRefundId,
        p_actor_admin_user_id: audit.actorAdminUserId,
        p_actor_role: audit.actorRole,
        p_reason: patch.reason,
      });
      if (error) throw new Error(`[scheduling] refund_visit_payment_with_audit failed: ${error.message}`);
      return toServiceVisitPaymentRow(data);
    },

    async createTaxReversalReconciliation(input) {
      const { data, error } = await supabase.rpc("create_tax_reversal_reconciliation", {
        p_target_entity_type: input.targetEntityType,
        p_target_entity_id: input.targetEntityId,
        p_original_transaction_id: input.originalTransactionId,
        p_intended_amount: input.intendedAmount,
        p_mode: input.mode,
      });
      if (error) throw new Error(`[scheduling] create_tax_reversal_reconciliation failed: ${error.message}`);
      return toTaxReversalReconciliationRow(data);
    },

    async findTaxReversalReconciliationById(id) {
      const { data, error } = await supabase.from("tax_reversal_reconciliations").select().eq("id", id).maybeSingle();
      if (error) throw new Error(`[scheduling] tax_reversal_reconciliations lookup by id failed: ${error.message}`);
      return data ? toTaxReversalReconciliationRow(data) : null;
    },

    async listTaxReversalReconciliationsForTarget(targetEntityType, targetEntityId) {
      const { data, error } = await supabase
        .from("tax_reversal_reconciliations")
        .select()
        .eq("target_entity_type", targetEntityType)
        .eq("target_entity_id", targetEntityId)
        .order("created_at", { ascending: true });
      if (error) throw new Error(`[scheduling] tax_reversal_reconciliations lookup by target failed: ${error.message}`);
      return (data ?? []).map(toTaxReversalReconciliationRow);
    },

    async markTaxReversalReconciliationSucceeded(id, stripeReversalId, audit) {
      const { data, error } = await supabase.rpc("mark_tax_reversal_reconciliation_succeeded", {
        p_id: id,
        p_stripe_reversal_id: stripeReversalId,
        p_actor_admin_user_id: audit.actorAdminUserId,
        p_actor_role: audit.actorRole,
      });
      if (error) throw new Error(`[scheduling] mark_tax_reversal_reconciliation_succeeded failed: ${error.message}`);
      return toTaxReversalReconciliationRow(data);
    },

    async markTaxReversalReconciliationFailed(id, failureMessage) {
      const { data, error } = await supabase.rpc("mark_tax_reversal_reconciliation_failed", {
        p_id: id,
        p_failure_message: failureMessage,
      });
      if (error) throw new Error(`[scheduling] mark_tax_reversal_reconciliation_failed failed: ${error.message}`);
      return toTaxReversalReconciliationRow(data);
    },

    async upsertStripeDisputeEvent(input) {
      const { data, error } = await supabase.rpc("upsert_stripe_dispute_event", {
        p_stripe_dispute_id: input.stripeDisputeId,
        p_stripe_charge_id: input.stripeChargeId,
        p_stripe_payment_intent_id: input.stripePaymentIntentId,
        p_amount: input.amount,
        p_currency: input.currency,
        p_dispute_status: input.disputeStatus,
        p_reason: input.reason,
        p_stripe_created_at: input.stripeCreatedAt.toISOString(),
        p_stripe_event_id: input.stripeEventId,
        p_stripe_event_created_at: input.stripeEventCreatedAt.toISOString(),
        p_is_closed: input.isClosed,
      });
      if (error) throw new Error(`[scheduling] upsert_stripe_dispute_event failed: ${error.message}`);
      return toStripeDisputeRow(data);
    },

    async findCustomerDisplayName(customerId) {
      const { data, error } = await supabase.from("customers").select("name").eq("id", customerId).maybeSingle();
      if (error) throw new Error(`[scheduling] customers lookup failed: ${error.message}`);
      return data?.name ?? "Customer";
    },

    async issueInvoice(input) {
      const { data, error } = await supabase.rpc("issue_invoice", {
        p_source_type: input.sourceType,
        p_service_visit_id: input.serviceVisitId,
        p_prepaid_package_id: input.prepaidPackageId,
        p_service_visit_pricing_id: input.serviceVisitPricingId,
        p_service_fee_assessment_id: input.serviceFeeAssessmentId,
        p_customer_id: input.customerId,
        p_customer_display_name: input.customerDisplayName,
        p_description: input.description,
        p_service_address_line1: input.serviceAddressLine1,
        p_service_address_line2: input.serviceAddressLine2,
        p_service_city: input.serviceCity,
        p_service_state: input.serviceState,
        p_service_zip: input.serviceZip,
        p_service_date: input.serviceDate,
        p_cleaning_type: input.cleaningType,
        p_currency: input.currency,
        p_base_amount: input.baseAmount,
        p_room_adjustments_amount: input.roomAdjustmentsAmount,
        p_add_ons_amount: input.addOnsAmount,
        p_add_ons_detail: input.addOnsDetail,
        p_travel_amount: input.travelAmount,
        p_supplies_amount: input.suppliesAmount,
        p_discount_amount: input.discountAmount,
        p_discount_description: input.discountDescription,
        p_cancellation_fee_amount: input.cancellationFeeAmount,
        p_tax_amount: input.taxAmount,
        p_subtotal_amount: input.subtotalAmount,
        p_total_amount: input.totalAmount,
        p_pricing_snapshot: input.pricingSnapshot,
      });
      if (error) throw new Error(`[scheduling] issue_invoice failed: ${error.message}`);
      return toInvoiceRow(data);
    },

    async issueReceipt(input) {
      const { data, error } = await supabase.rpc("issue_receipt", {
        p_invoice_id: input.invoiceId,
        p_customer_id: input.customerId,
        p_source_type: input.sourceType,
        p_service_visit_payment_id: input.serviceVisitPaymentId,
        p_service_fee_assessment_id: input.serviceFeeAssessmentId,
        p_prepaid_package_id: input.prepaidPackageId,
        p_payment_timestamp: input.paymentTimestamp.toISOString(),
        p_amount_paid: input.amountPaid,
        p_tax_paid: input.taxPaid,
        p_tip_paid: input.tipPaid,
        p_payment_method_display: input.paymentMethodDisplay,
        p_stripe_payment_intent_id: input.stripePaymentIntentId,
        p_stripe_charge_id: input.stripeChargeId,
        p_currency: input.currency,
      });
      if (error) throw new Error(`[scheduling] issue_receipt failed: ${error.message}`);
      return toReceiptRow(data);
    },

    async findInvoiceById(id) {
      const { data, error } = await supabase.from("invoices").select("*").eq("id", id).maybeSingle();
      if (error) throw new Error(`[scheduling] findInvoiceById failed: ${error.message}`);
      return data ? toInvoiceRow(data) : null;
    },

    async findReceiptById(id) {
      const { data, error } = await supabase.from("receipts").select("*").eq("id", id).maybeSingle();
      if (error) throw new Error(`[scheduling] findReceiptById failed: ${error.message}`);
      return data ? toReceiptRow(data) : null;
    },

    async listInvoicesForCustomer(customerId) {
      const { data, error } = await supabase.from("invoices").select("*").eq("customer_id", customerId).order("issue_date", { ascending: false });
      if (error) throw new Error(`[scheduling] listInvoicesForCustomer failed: ${error.message}`);
      return (data ?? []).map(toInvoiceRow);
    },

    async listReceiptsForCustomer(customerId) {
      const { data, error } = await supabase.from("receipts").select("*").eq("customer_id", customerId).order("payment_timestamp", { ascending: false });
      if (error) throw new Error(`[scheduling] listReceiptsForCustomer failed: ${error.message}`);
      return (data ?? []).map(toReceiptRow);
    },

    async voidInvoiceWithAudit(id, reason, audit) {
      const { data, error } = await supabase.rpc("void_invoice_with_audit", {
        p_invoice_id: id,
        p_reason: reason,
        p_actor_admin_user_id: audit.actorAdminUserId,
        p_actor_role: audit.actorRole,
      });
      if (error) throw new Error(`[scheduling] void_invoice_with_audit failed: ${error.message}`);
      return toInvoiceRow(data);
    },
  };
}
