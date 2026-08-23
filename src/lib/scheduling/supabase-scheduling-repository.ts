import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
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
  ServiceVisitRow,
} from "./domain-types";
import { SchedulingConflictError } from "./errors";
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
    completedAt: row.completed_at ? new Date(row.completed_at as string) : null,
    cancelledAt: row.cancelled_at ? new Date(row.cancelled_at as string) : null,
    serviceAddressLine1: (row.service_address_line1 as string | null) ?? null,
    serviceAddressLine2: (row.service_address_line2 as string | null) ?? null,
    serviceCity: (row.service_city as string | null) ?? null,
    serviceState: (row.service_state as string | null) ?? null,
    serviceAddressIdentity: (row.service_address_identity as string | null) ?? null,
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
    effectivePricePerVisit: Number(row.effective_price_per_visit),
    status: row.status as PrepaidPackageRow["status"],
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

    async listActiveAssignmentsInRange(rangeStartUtc, rangeEndUtc): Promise<ActiveAssignmentIntervalRow[]> {
      // Queried from service_visits (not service_visit_assignments) so the
      // confirmed_start_at range filter applies to a plain base-table
      // column rather than an embedded/joined one; unassigned_at IS NULL is
      // then applied client-side over the nested assignment rows, avoiding
      // any ambiguity in filtering an embedded resource's own columns.
      const { data, error } = await supabase
        .from("service_visits")
        .select("confirmed_start_at,confirmed_end_at,turnaround_buffer_minutes,service_visit_assignments(cleaner_id,unassigned_at)")
        .eq("status", "scheduled")
        .gte("confirmed_start_at", rangeStartUtc.toISOString())
        .lt("confirmed_start_at", rangeEndUtc.toISOString());
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
      const { error } = await supabase
        .from("service_visit_notifications")
        .update({ state: "cancelled" })
        .eq("service_visit_id", serviceVisitId)
        .eq("state", "pending");
      if (error) throw new Error(`[scheduling] cancelling pending notifications failed: ${error.message}`);
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
        .select("id,customer_id,booking_order_id,frequency,purchased_visit_count,remaining_visit_count,effective_price_per_visit,status")
        .eq("id", id)
        .maybeSingle();
      if (error) throw new Error(`[scheduling] prepaid_packages lookup failed: ${error.message}`);
      return data ? toPrepaidPackageRow(data) : null;
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
  };
}
