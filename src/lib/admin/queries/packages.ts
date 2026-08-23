import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export interface AdminPackageSummary {
  id: string;
  customerId: string;
  customerName: string;
  frequency: string;
  status: string;
  purchasedVisitCount: number;
  remainingVisitCount: number;
  effectivePricePerVisit: number;
}

export async function listPackages(): Promise<AdminPackageSummary[]> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("prepaid_packages")
    .select("id,customer_id,frequency,status,purchased_visit_count,remaining_visit_count,effective_price_per_visit")
    .order("purchased_at", { ascending: false });
  if (error) {
    throw new Error(`[admin] prepaid_packages lookup failed: ${error.message}`);
  }
  const rows = data ?? [];

  const customerIds = [...new Set(rows.map((r) => r.customer_id))];
  const customerNameById = new Map<string, string>();
  if (customerIds.length > 0) {
    const { data: customers, error: customersError } = await supabase.from("customers").select("id,name").in("id", customerIds);
    if (customersError) {
      throw new Error(`[admin] customers lookup failed: ${customersError.message}`);
    }
    for (const c of customers ?? []) customerNameById.set(c.id, c.name);
  }

  return rows.map((r) => ({
    id: r.id,
    customerId: r.customer_id,
    customerName: customerNameById.get(r.customer_id) ?? "Unknown customer",
    frequency: r.frequency,
    status: r.status,
    purchasedVisitCount: r.purchased_visit_count,
    remainingVisitCount: r.remaining_visit_count,
    effectivePricePerVisit: Number(r.effective_price_per_visit),
  }));
}

export interface AdminPackageVisitPlan {
  id: string;
  visitNumber: number;
  plannedDate: string;
  plannedStartTime: string;
  status: "planned" | "linked";
  serviceVisitId: string | null;
  /** The linked service_visit's own status, when linked — this, not the plan's own status, is the true Completed/Scheduled/Cancelled state a linked plan carries. Null when still merely planned. */
  linkedVisitStatus: "requested" | "scheduled" | "completed" | "cancelled" | null;
}

export interface AdminPackageAmendment {
  id: string;
  oldCadence: string;
  newCadence: string;
  effectiveFromVisitNumber: number;
  oldRemainingValue: number;
  newRemainingValue: number;
  valueDifference: number;
  approvalState: string;
  paymentState: string;
  reason: string | null;
  createdAt: string;
}

export interface AdminPackageUsage {
  id: string;
  serviceVisitId: string;
  visitNumber: number | null;
  consumedAt: string;
}

export interface AdminPackagePlanHistoryEntry {
  id: string;
  visitNumber: number;
  previousPlannedDate: string | null;
  newPlannedDate: string;
  previousStatus: string | null;
  newStatus: string;
  changeReason: string;
  occurredAt: string;
}

export interface AdminPackageDetail extends AdminPackageSummary {
  bookingOrderId: string;
  plans: AdminPackageVisitPlan[];
  amendments: AdminPackageAmendment[];
  usages: AdminPackageUsage[];
  planHistory: AdminPackagePlanHistoryEntry[];
}

export async function findPackageDetail(packageId: string): Promise<AdminPackageDetail | null> {
  const supabase = createSupabaseAdminClient();

  const { data: pkg, error: pkgError } = await supabase
    .from("prepaid_packages")
    .select("id,customer_id,booking_order_id,frequency,status,purchased_visit_count,remaining_visit_count,effective_price_per_visit")
    .eq("id", packageId)
    .maybeSingle();
  if (pkgError) {
    throw new Error(`[admin] prepaid_package lookup failed: ${pkgError.message}`);
  }
  if (!pkg) {
    return null;
  }

  const { data: customer, error: customerError } = await supabase
    .from("customers")
    .select("name")
    .eq("id", pkg.customer_id)
    .maybeSingle();
  if (customerError) {
    throw new Error(`[admin] customer lookup failed: ${customerError.message}`);
  }

  const { data: planRows, error: plansError } = await supabase
    .from("package_visit_plans")
    .select("id,visit_number,planned_date,planned_start_time,status,service_visit_id,service_visits(status)")
    .eq("prepaid_package_id", packageId)
    .order("visit_number", { ascending: true });
  if (plansError) {
    throw new Error(`[admin] package_visit_plans lookup failed: ${plansError.message}`);
  }

  const { data: amendmentRows, error: amendmentsError } = await supabase
    .from("package_amendments")
    .select(
      "id,old_cadence,new_cadence,effective_from_visit_number,old_remaining_value,new_remaining_value,value_difference,approval_state,payment_state,reason,created_at"
    )
    .eq("prepaid_package_id", packageId)
    .order("created_at", { ascending: false });
  if (amendmentsError) {
    throw new Error(`[admin] package_amendments lookup failed: ${amendmentsError.message}`);
  }

  const { data: usageRows, error: usagesError } = await supabase
    .from("package_visit_usages")
    .select("id,service_visit_id,visit_number,consumed_at")
    .eq("prepaid_package_id", packageId)
    .order("consumed_at", { ascending: false });
  if (usagesError) {
    throw new Error(`[admin] package_visit_usages lookup failed: ${usagesError.message}`);
  }

  const { data: historyRows, error: historyError } = await supabase
    .from("package_visit_plan_history")
    .select("id,visit_number,previous_planned_date,new_planned_date,previous_status,new_status,change_reason,occurred_at")
    .eq("prepaid_package_id", packageId)
    .order("occurred_at", { ascending: false });
  if (historyError) {
    throw new Error(`[admin] package_visit_plan_history lookup failed: ${historyError.message}`);
  }

  type PlanRow = {
    id: string;
    visit_number: number;
    planned_date: string;
    planned_start_time: string;
    status: "planned" | "linked";
    service_visit_id: string | null;
    service_visits: { status: AdminPackageVisitPlan["linkedVisitStatus"] } | null;
  };

  return {
    id: pkg.id,
    customerId: pkg.customer_id,
    customerName: customer?.name ?? "Unknown customer",
    bookingOrderId: pkg.booking_order_id,
    frequency: pkg.frequency,
    status: pkg.status,
    purchasedVisitCount: pkg.purchased_visit_count,
    remainingVisitCount: pkg.remaining_visit_count,
    effectivePricePerVisit: Number(pkg.effective_price_per_visit),
    plans: ((planRows ?? []) as unknown as PlanRow[]).map((p) => ({
      id: p.id,
      visitNumber: p.visit_number,
      plannedDate: p.planned_date,
      plannedStartTime: p.planned_start_time,
      status: p.status,
      serviceVisitId: p.service_visit_id,
      linkedVisitStatus: p.service_visits?.status ?? null,
    })),
    amendments: (amendmentRows ?? []).map((a) => ({
      id: a.id,
      oldCadence: a.old_cadence,
      newCadence: a.new_cadence,
      effectiveFromVisitNumber: a.effective_from_visit_number,
      oldRemainingValue: Number(a.old_remaining_value),
      newRemainingValue: Number(a.new_remaining_value),
      valueDifference: Number(a.value_difference),
      approvalState: a.approval_state,
      paymentState: a.payment_state,
      reason: a.reason,
      createdAt: a.created_at,
    })),
    usages: (usageRows ?? []).map((u) => ({
      id: u.id,
      serviceVisitId: u.service_visit_id,
      visitNumber: u.visit_number,
      consumedAt: u.consumed_at,
    })),
    planHistory: (historyRows ?? []).map((h) => ({
      id: h.id,
      visitNumber: h.visit_number,
      previousPlannedDate: h.previous_planned_date,
      newPlannedDate: h.new_planned_date,
      previousStatus: h.previous_status,
      newStatus: h.new_status,
      changeReason: h.change_reason,
      occurredAt: h.occurred_at,
    })),
  };
}
