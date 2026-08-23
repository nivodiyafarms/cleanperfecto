import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseSchedulingRepository } from "@/lib/scheduling/supabase-scheduling-repository";
import { localDateOf, localTimeOf } from "@/lib/admin/format";
import type { CalendarDate, TimeOfDay } from "@/lib/scheduling/types";

export interface NextVisitSummary {
  recurringVisitPlanId: string;
  recurringScheduleId: string;
  visitNumber: number;
  date: CalendarDate;
  startTime: TimeOfDay;
  status: "confirmed" | "requested" | "planned";
  serviceVisitId: string | null;
}

/**
 * The universal "next six cleanings" calendar for a customer, regardless of
 * payment model — reads recurring_visit_plans (the universal planning
 * layer) for every active recurring_schedules row, resolving a 'linked'
 * plan's real status/time from its service_visits row. A completed or
 * cancelled linked visit is dropped (it's no longer "next"), matching the
 * same "outstanding" definition replenish-recurring-visit-plans.ts uses.
 */
export async function listNextSixVisits(customerId: string): Promise<NextVisitSummary[]> {
  const repo = createSupabaseSchedulingRepository();
  const schedules = await repo.listActiveRecurringSchedulesForCustomer(customerId);

  const results: NextVisitSummary[] = [];
  for (const schedule of schedules) {
    const plans = await repo.listRecurringVisitPlans(schedule.id);
    for (const plan of plans) {
      if (plan.status === "planned") {
        results.push({
          recurringVisitPlanId: plan.id,
          recurringScheduleId: schedule.id,
          visitNumber: plan.visitNumber,
          date: plan.plannedDate,
          startTime: plan.plannedStartTime,
          status: "planned",
          serviceVisitId: null,
        });
        continue;
      }
      if (plan.status === "linked" && plan.serviceVisitId) {
        const visit = await repo.findServiceVisitById(plan.serviceVisitId);
        if (!visit || visit.status === "completed" || visit.status === "cancelled") {
          continue;
        }
        const usesConfirmedTime = visit.status === "scheduled" && visit.confirmedStartAt;
        results.push({
          recurringVisitPlanId: plan.id,
          recurringScheduleId: schedule.id,
          visitNumber: plan.visitNumber,
          date: usesConfirmedTime ? localDateOf(visit.confirmedStartAt!.toISOString()) : plan.plannedDate,
          startTime: usesConfirmedTime ? localTimeOf(visit.confirmedStartAt!.toISOString()) : plan.plannedStartTime,
          status: usesConfirmedTime ? "confirmed" : "requested",
          serviceVisitId: visit.id,
        });
      }
    }
  }

  results.sort((a, b) => (a.date + a.startTime).localeCompare(b.date + b.startTime));
  return results.slice(0, 6);
}

/** Does this customer have any active recurring relationship at all (Pay Per Cleaning or prepaid package)? Drives whether /my shows the full recurring-customer experience or the reduced one-time-customer view. */
export async function hasActiveRecurringRelationship(customerId: string): Promise<boolean> {
  const repo = createSupabaseSchedulingRepository();
  const schedules = await repo.listActiveRecurringSchedulesForCustomer(customerId);
  return schedules.length > 0;
}

export interface ActivePackageSummary {
  id: string;
  purchasedVisitCount: number;
  remainingVisitCount: number;
  status: "active" | "completed" | "cancelled";
  frequency: string;
}

/** The customer's most recent prepaid package, regardless of remaining credit (0 remaining is a valid, displayable state — "completed" package history). Purely a display read, not the credit-resolution used by scheduling. */
export async function getMostRecentPackageSummary(customerId: string): Promise<ActivePackageSummary | null> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("prepaid_packages")
    .select("id, purchased_visit_count, remaining_visit_count, status, frequency")
    .eq("customer_id", customerId)
    .order("purchased_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`[customer-portal] prepaid_packages lookup failed: ${error.message}`);
  if (!data) return null;
  return {
    id: data.id,
    purchasedVisitCount: data.purchased_visit_count,
    remainingVisitCount: data.remaining_visit_count,
    status: data.status,
    frequency: data.frequency,
  };
}

export interface CustomerProfile {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
}

export async function getCustomerProfile(customerId: string): Promise<CustomerProfile | null> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.from("customers").select("id, name, email, phone").eq("id", customerId).maybeSingle();
  if (error) throw new Error(`[customer-portal] customers lookup failed: ${error.message}`);
  return data ? { id: data.id, name: data.name, email: data.email, phone: data.phone } : null;
}

export interface ServiceAddress {
  line1: string | null;
  line2: string | null;
  city: string | null;
  state: string | null;
}

/** Service address isn't stored on customers (each visit snapshots its own) — the most recent visit's address is the best available "on file" address for profile display. */
export async function getMostRecentServiceAddress(customerId: string): Promise<ServiceAddress | null> {
  const repo = createSupabaseSchedulingRepository();
  const visits = await repo.listServiceVisitsForCustomer(customerId);
  const withAddress = visits.find((v) => v.serviceAddressLine1);
  if (!withAddress) return null;
  return {
    line1: withAddress.serviceAddressLine1,
    line2: withAddress.serviceAddressLine2,
    city: withAddress.serviceCity,
    state: withAddress.serviceState,
  };
}

export interface PaymentsSummary {
  fees: { id: string; feeType: string; amount: number; state: string; visitDate: string | null }[];
  visitPricing: { serviceVisitId: string; totalAmount: number; amountDueFromCustomer: number; priceStatus: string; paymentStatus: string }[];
  packageAmendments: { id: string; valueDifference: number; approvalState: string; paymentState: string }[];
}

/**
 * Safe financial history for the Payments page — derived entirely from
 * existing authoritative records (service_fee_assessments,
 * service_visit_pricing, package_amendments), never a duplicate history
 * table. Never surfaces Stripe object ids or any payment credential.
 */
export async function getPaymentsSummary(customerId: string): Promise<PaymentsSummary> {
  const supabase = createSupabaseAdminClient();
  const repo = createSupabaseSchedulingRepository();

  const visits = await repo.listServiceVisitsForCustomer(customerId);
  const visitIds = visits.map((v) => v.id);

  const fees: PaymentsSummary["fees"] = [];
  if (visitIds.length > 0) {
    const { data, error } = await supabase
      .from("service_fee_assessments")
      .select("id, fee_type, amount, state, service_visit_id")
      .in("service_visit_id", visitIds);
    if (error) throw new Error(`[customer-portal] service_fee_assessments lookup failed: ${error.message}`);
    for (const row of data ?? []) {
      const visit = visits.find((v) => v.id === row.service_visit_id);
      fees.push({
        id: row.id,
        feeType: row.fee_type,
        amount: Number(row.amount),
        state: row.state,
        visitDate: visit?.confirmedStartAt ? localDateOf(visit.confirmedStartAt.toISOString()) : null,
      });
    }
  }

  const visitPricing: PaymentsSummary["visitPricing"] = [];
  for (const visit of visits) {
    if (!visit.recurringScheduleId) continue;
    const pricing = await repo.findServiceVisitPricingByVisitId(visit.id);
    if (pricing) {
      visitPricing.push({
        serviceVisitId: visit.id,
        totalAmount: pricing.totalAmount,
        amountDueFromCustomer: pricing.amountDueFromCustomer,
        priceStatus: pricing.priceStatus,
        paymentStatus: pricing.paymentStatus,
      });
    }
  }

  const packageSummary = await getMostRecentPackageSummary(customerId);
  let packageAmendments: PaymentsSummary["packageAmendments"] = [];
  if (packageSummary) {
    const { data, error } = await supabase
      .from("package_amendments")
      .select("id, value_difference, approval_state, payment_state")
      .eq("prepaid_package_id", packageSummary.id)
      .order("created_at", { ascending: false });
    if (error) throw new Error(`[customer-portal] package_amendments lookup failed: ${error.message}`);
    packageAmendments = (data ?? []).map((r) => ({
      id: r.id,
      valueDifference: Number(r.value_difference),
      approvalState: r.approval_state,
      paymentState: r.payment_state,
    }));
  }

  return { fees, visitPricing, packageAmendments };
}

export interface CleaningHistoryEntry {
  id: string;
  status: string;
  cleaningType: string | null;
  confirmedDate: string | null;
  confirmedTime: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
}

/** Completed/cancelled service_visits for the "My Cleanings" history list — derived from the existing authoritative service_visits table, no duplicate history table. */
export async function listCleaningHistory(customerId: string): Promise<CleaningHistoryEntry[]> {
  const repo = createSupabaseSchedulingRepository();
  const visits = await repo.listServiceVisitsForCustomer(customerId);
  return visits
    .filter((v) => v.status === "completed" || v.status === "cancelled")
    .map((v) => ({
      id: v.id,
      status: v.status,
      cleaningType: v.cleaningType,
      confirmedDate: v.confirmedStartAt ? localDateOf(v.confirmedStartAt.toISOString()) : null,
      confirmedTime: v.confirmedStartAt ? localTimeOf(v.confirmedStartAt.toISOString()) : null,
      completedAt: v.completedAt ? v.completedAt.toISOString() : null,
      cancelledAt: v.cancelledAt ? v.cancelledAt.toISOString() : null,
    }));
}
