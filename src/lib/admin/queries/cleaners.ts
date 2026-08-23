import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export interface AdminCleaner {
  id: string;
  name: string;
  active: boolean;
}

export async function listCleaners(): Promise<AdminCleaner[]> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.from("cleaners").select("id,name,active").order("name", { ascending: true });
  if (error) {
    throw new Error(`[admin] cleaners lookup failed: ${error.message}`);
  }
  return data ?? [];
}

export async function findCleaner(cleanerId: string): Promise<AdminCleaner | null> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.from("cleaners").select("id,name,active").eq("id", cleanerId).maybeSingle();
  if (error) {
    throw new Error(`[admin] cleaner lookup failed: ${error.message}`);
  }
  return data;
}

export interface AdminAvailabilityRule {
  id: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  active: boolean;
}

export async function listAvailabilityRules(cleanerId: string): Promise<AdminAvailabilityRule[]> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("cleaner_availability_rules")
    .select("id,day_of_week,start_time,end_time,active")
    .eq("cleaner_id", cleanerId)
    .order("day_of_week", { ascending: true });
  if (error) {
    throw new Error(`[admin] cleaner_availability_rules lookup failed: ${error.message}`);
  }
  return (data ?? []).map((r) => ({ id: r.id, dayOfWeek: r.day_of_week, startTime: r.start_time, endTime: r.end_time, active: r.active }));
}

export interface AdminAvailabilityException {
  id: string;
  exceptionDate: string;
  type: "unavailable_all_day" | "custom_hours";
  startTime: string | null;
  endTime: string | null;
  reason: string | null;
}

export async function listAvailabilityExceptions(cleanerId: string): Promise<AdminAvailabilityException[]> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("cleaner_availability_exceptions")
    .select("id,exception_date,type,start_time,end_time,reason")
    .eq("cleaner_id", cleanerId)
    .order("exception_date", { ascending: true });
  if (error) {
    throw new Error(`[admin] cleaner_availability_exceptions lookup failed: ${error.message}`);
  }
  return (data ?? []).map((r) => ({
    id: r.id,
    exceptionDate: r.exception_date,
    type: r.type,
    startTime: r.start_time,
    endTime: r.end_time,
    reason: r.reason,
  }));
}

export interface AdminUpcomingAssignment {
  serviceVisitId: string;
  confirmedStartAt: string;
  confirmedEndAt: string | null;
  status: string;
  customerName: string;
}

/** Upcoming (confirmed, not yet completed/cancelled) assignments for a cleaner — active assignment rows only. */
export async function listUpcomingAssignments(cleanerId: string): Promise<AdminUpcomingAssignment[]> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("service_visit_assignments")
    .select("service_visit_id,unassigned_at,service_visits(id,confirmed_start_at,confirmed_end_at,status,customer_id)")
    .eq("cleaner_id", cleanerId)
    .is("unassigned_at", null);
  if (error) {
    throw new Error(`[admin] upcoming assignments lookup failed: ${error.message}`);
  }

  type Row = {
    service_visit_id: string;
    service_visits: { id: string; confirmed_start_at: string | null; confirmed_end_at: string | null; status: string; customer_id: string } | null;
  };
  const rows = ((data ?? []) as unknown as Row[]).filter(
    (r) => r.service_visits && r.service_visits.status === "scheduled" && r.service_visits.confirmed_start_at
  );

  const customerIds = [...new Set(rows.map((r) => r.service_visits!.customer_id))];
  const customerNameById = new Map<string, string>();
  if (customerIds.length > 0) {
    const { data: customers, error: customersError } = await supabase.from("customers").select("id,name").in("id", customerIds);
    if (customersError) {
      throw new Error(`[admin] customers lookup failed: ${customersError.message}`);
    }
    for (const c of customers ?? []) customerNameById.set(c.id, c.name);
  }

  return rows
    .map((r) => ({
      serviceVisitId: r.service_visits!.id,
      confirmedStartAt: r.service_visits!.confirmed_start_at as string,
      confirmedEndAt: r.service_visits!.confirmed_end_at,
      status: r.service_visits!.status,
      customerName: customerNameById.get(r.service_visits!.customer_id) ?? "Unknown customer",
    }))
    .sort((a, b) => a.confirmedStartAt.localeCompare(b.confirmedStartAt));
}
