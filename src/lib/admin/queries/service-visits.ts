import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export interface AdminAssignedCleaner {
  cleanerId: string;
  cleanerName: string;
}

/**
 * A schedule-grid/list row shape — a UI display projection, not a domain
 * type. Deliberately NOT added to SchedulingRepository/ServiceVisitRow:
 * this is a multi-table join (service_visits + customers + cleaners) built
 * for display, never consumed by a domain workflow function, so it has no
 * business living on the interface fake-scheduling-repository.ts doubles
 * for unit tests. See src/lib/scheduling/repository.ts's own comment on
 * what that interface is actually for.
 */
export interface AdminScheduleVisit {
  id: string;
  status: "requested" | "scheduled" | "work_finished" | "completed" | "cancelled";
  cleaningType: string | null;
  frequency: string | null;
  visitNumber: number | null;
  requestedStartAt: string | null;
  confirmedStartAt: string | null;
  confirmedEndAt: string | null;
  estimatedServiceMinutes: number | null;
  prepaidPackageId: string | null;
  bookingOrderId: string | null;
  customerId: string;
  customerName: string;
  serviceCity: string | null;
  serviceState: string | null;
  serviceZip: string | null;
  assignedCleaners: AdminAssignedCleaner[];
}

const VISIT_SELECT =
  "id,status,cleaning_type,frequency,visit_number,requested_start_at,confirmed_start_at,confirmed_end_at,estimated_service_minutes,prepaid_package_id,booking_order_id,customer_id,service_city,service_state,service_zip,service_visit_assignments(cleaner_id,unassigned_at,cleaners(name))";

interface RawVisitRow {
  id: string;
  status: AdminScheduleVisit["status"];
  cleaning_type: string | null;
  frequency: string | null;
  visit_number: number | null;
  requested_start_at: string | null;
  confirmed_start_at: string | null;
  confirmed_end_at: string | null;
  estimated_service_minutes: number | null;
  prepaid_package_id: string | null;
  booking_order_id: string | null;
  customer_id: string;
  service_city: string | null;
  service_state: string | null;
  service_zip: string | null;
  service_visit_assignments: { cleaner_id: string; unassigned_at: string | null; cleaners: { name: string } | null }[] | null;
}

async function attachCustomerNames(rows: RawVisitRow[]): Promise<AdminScheduleVisit[]> {
  const supabase = createSupabaseAdminClient();
  const customerIds = [...new Set(rows.map((r) => r.customer_id))];
  const customerNameById = new Map<string, string>();

  if (customerIds.length > 0) {
    const { data, error } = await supabase.from("customers").select("id,name").in("id", customerIds);
    if (error) {
      throw new Error(`[admin] customers lookup failed: ${error.message}`);
    }
    for (const c of data ?? []) {
      customerNameById.set(c.id, c.name);
    }
  }

  return rows.map((row) => ({
    id: row.id,
    status: row.status,
    cleaningType: row.cleaning_type,
    frequency: row.frequency,
    visitNumber: row.visit_number,
    requestedStartAt: row.requested_start_at,
    confirmedStartAt: row.confirmed_start_at,
    confirmedEndAt: row.confirmed_end_at,
    estimatedServiceMinutes: row.estimated_service_minutes,
    prepaidPackageId: row.prepaid_package_id,
    bookingOrderId: row.booking_order_id,
    customerId: row.customer_id,
    customerName: customerNameById.get(row.customer_id) ?? "Unknown customer",
    serviceCity: row.service_city,
    serviceState: row.service_state,
    serviceZip: row.service_zip,
    assignedCleaners: (row.service_visit_assignments ?? [])
      .filter((a) => a.unassigned_at === null)
      .map((a) => ({ cleanerId: a.cleaner_id, cleanerName: a.cleaners?.name ?? "Unknown cleaner" })),
  }));
}

/**
 * Visits belonging on the schedule grid for [rangeStartUtc, rangeEndUtc):
 * a CONFIRMED visit shows at its confirmed_start_at, a still-REQUESTED
 * visit shows at its requested_start_at (per the spec's own "Requested
 * 10:00 AM" vs "10:00 AM – 1:30 PM" distinction) — either counts as
 * belonging to this range. Cancelled/completed visits outside their own
 * original slot are not specially surfaced here; this is the operational
 * grid, not history.
 */
export async function listServiceVisitsInRange(rangeStartUtc: Date, rangeEndUtc: Date): Promise<AdminScheduleVisit[]> {
  const supabase = createSupabaseAdminClient();
  const startIso = rangeStartUtc.toISOString();
  const endIso = rangeEndUtc.toISOString();

  const { data, error } = await supabase
    .from("service_visits")
    .select(VISIT_SELECT)
    .or(
      `and(confirmed_start_at.gte.${startIso},confirmed_start_at.lt.${endIso}),and(status.eq.requested,requested_start_at.gte.${startIso},requested_start_at.lt.${endIso})`
    )
    .order("confirmed_start_at", { ascending: true, nullsFirst: false });
  if (error) {
    throw new Error(`[admin] service_visits range lookup failed: ${error.message}`);
  }

  return attachCustomerNames((data ?? []) as unknown as RawVisitRow[]);
}

/** Every visit still in 'requested' status, oldest request first — the Requests queue. */
export async function listRequestedServiceVisits(): Promise<AdminScheduleVisit[]> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("service_visits")
    .select(VISIT_SELECT)
    .eq("status", "requested")
    .order("requested_start_at", { ascending: true });
  if (error) {
    throw new Error(`[admin] requested service_visits lookup failed: ${error.message}`);
  }
  return attachCustomerNames((data ?? []) as unknown as RawVisitRow[]);
}

export interface AdminServiceVisitDetail extends AdminScheduleVisit {
  timezone: string;
  estimatedLaborMinutes: number | null;
  recommendedCleanerCount: number | null;
  turnaroundBufferMinutes: number | null;
  serviceAddressLine1: string | null;
  serviceAddressLine2: string | null;
  quoteRequestId: string | null;
  recurringScheduleId: string | null;
  reviewRequestSuppressed: boolean;
}

const VISIT_DETAIL_SELECT = `${VISIT_SELECT},timezone,estimated_labor_minutes,recommended_cleaner_count,turnaround_buffer_minutes,service_address_line1,service_address_line2,quote_request_id,recurring_schedule_id,review_request_suppressed`;

export async function findServiceVisitDetail(visitId: string): Promise<AdminServiceVisitDetail | null> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.from("service_visits").select(VISIT_DETAIL_SELECT).eq("id", visitId).maybeSingle();
  if (error) {
    throw new Error(`[admin] service_visit detail lookup failed: ${error.message}`);
  }
  if (!data) {
    return null;
  }
  const [mapped] = await attachCustomerNames([data as unknown as RawVisitRow]);
  const raw = data as unknown as RawVisitRow & {
    timezone: string;
    estimated_labor_minutes: number | null;
    recommended_cleaner_count: number | null;
    turnaround_buffer_minutes: number | null;
    service_address_line1: string | null;
    service_address_line2: string | null;
    quote_request_id: string | null;
    recurring_schedule_id: string | null;
    review_request_suppressed: boolean;
  };
  return {
    ...mapped,
    timezone: raw.timezone,
    estimatedLaborMinutes: raw.estimated_labor_minutes,
    recommendedCleanerCount: raw.recommended_cleaner_count,
    turnaroundBufferMinutes: raw.turnaround_buffer_minutes,
    serviceAddressLine1: raw.service_address_line1,
    serviceAddressLine2: raw.service_address_line2,
    quoteRequestId: raw.quote_request_id,
    recurringScheduleId: raw.recurring_schedule_id,
    reviewRequestSuppressed: raw.review_request_suppressed,
  };
}

export interface AdminServiceVisitEvent {
  id: string;
  eventType: string;
  occurredAt: string;
  actor: string | null;
  notes: string | null;
  previousState: unknown;
  newState: unknown;
}

/** Read-only — service_visit_events is append-only at the DB grant level; no update/delete affordance is ever rendered for this. */
export async function listServiceVisitEvents(visitId: string): Promise<AdminServiceVisitEvent[]> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("service_visit_events")
    .select("id,event_type,occurred_at,actor,notes,previous_state,new_state")
    .eq("service_visit_id", visitId)
    .order("occurred_at", { ascending: true });
  if (error) {
    throw new Error(`[admin] service_visit_events lookup failed: ${error.message}`);
  }
  return (data ?? []).map((row) => ({
    id: row.id,
    eventType: row.event_type,
    occurredAt: row.occurred_at,
    actor: row.actor,
    notes: row.notes,
    previousState: row.previous_state,
    newState: row.new_state,
  }));
}

export interface AdminServiceFeeAssessment {
  id: string;
  feeType: string;
  amount: number;
  policyVersion: string;
  reason: string | null;
  state: string;
  assessedAt: string;
}

export async function listServiceFeeAssessments(visitId: string): Promise<AdminServiceFeeAssessment[]> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("service_fee_assessments")
    .select("id,fee_type,amount,policy_version,reason,state,assessed_at")
    .eq("service_visit_id", visitId)
    .order("assessed_at", { ascending: false });
  if (error) {
    throw new Error(`[admin] service_fee_assessments lookup failed: ${error.message}`);
  }
  return (data ?? []).map((row) => ({
    id: row.id,
    feeType: row.fee_type,
    amount: Number(row.amount),
    policyVersion: row.policy_version,
    reason: row.reason,
    state: row.state,
    assessedAt: row.assessed_at,
  }));
}
