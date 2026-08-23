import type { CleaningType } from "@/lib/pricing/types";
import { InvalidVisitStateError } from "./errors";
import type { SchedulingRepository } from "./repository";
import { syncPackagePlanFromRecurringPlan } from "./sync-linked-recurring-package-plan";
import { zonedDateTimeToUtc } from "./timezone";

const DEFAULT_TIMEZONE = "America/Chicago";

export interface ScheduleRecurringVisitPlanInput {
  recurringVisitPlanId: string;
  customerId: string;
  cleaningType: CleaningType;
  serviceAddressLine1: string | null;
  serviceAddressLine2: string | null;
  serviceCity: string | null;
  serviceState: string | null;
  serviceAddressIdentity: string | null;
  timezone?: string;
}

/**
 * Turns a planning-stage recurring_visit_plans row into a real 'requested'
 * service_visits row — the universal equivalent of
 * schedule-package-visit-plan.ts, used for BOTH Pay Per Cleaning and
 * prepaid-package customers.
 *
 * Whether THIS occurrence draws a prepaid-package credit is resolved HERE,
 * dynamically, by checking the customer's currently active prepaid_packages
 * balance (owner-approved correction: prepaid coverage is a financial fact
 * decided per-visit at this moment, never baked into the schedule/plan
 * itself). Once every package is exhausted, findActivePrepaidPackageForCustomer
 * returns null and this naturally produces a Pay Per Cleaning visit
 * (prepaidPackageId stays null) under the very same recurring_schedule_id —
 * the schedule/calendar is the constant; payment model is a per-visit
 * financial fact layered on top.
 *
 * Idempotent: a plan already 'linked' to a service_visit returns that
 * existing visit rather than creating a second one.
 */
export async function scheduleRecurringVisitPlan(
  repo: SchedulingRepository,
  input: ScheduleRecurringVisitPlanInput
): Promise<{ visitId: string; alreadyLinked: boolean; prepaidPackageId: string | null }> {
  const plan = await repo.findRecurringVisitPlanById(input.recurringVisitPlanId);
  if (!plan) {
    throw new InvalidVisitStateError(`recurring_visit_plan ${input.recurringVisitPlanId} not found`);
  }
  if (plan.status === "linked" && plan.serviceVisitId) {
    const existingVisit = await repo.findServiceVisitById(plan.serviceVisitId);
    return {
      visitId: plan.serviceVisitId,
      alreadyLinked: true,
      prepaidPackageId: existingVisit?.prepaidPackageId ?? null,
    };
  }

  const timezone = input.timezone ?? DEFAULT_TIMEZONE;
  const requestedStartAt = zonedDateTimeToUtc(plan.plannedDate, plan.plannedStartTime, timezone);

  const coveringPackage = await repo.findActivePrepaidPackageForCustomer(input.customerId);

  const visit = await repo.insertServiceVisit({
    customerId: input.customerId,
    quoteRequestId: null,
    bookingOrderId: null,
    prepaidPackageId: coveringPackage?.id ?? null,
    recurringScheduleId: plan.recurringScheduleId,
    visitNumber: plan.visitNumber,
    cleaningType: input.cleaningType,
    frequency: null,
    requestedStartAt,
    timezone,
    serviceAddressLine1: input.serviceAddressLine1,
    serviceAddressLine2: input.serviceAddressLine2,
    serviceCity: input.serviceCity,
    serviceState: input.serviceState,
    serviceAddressIdentity: input.serviceAddressIdentity,
  });

  await repo.updateRecurringVisitPlan(plan.id, { status: "linked", serviceVisitId: visit.id });

  await repo.insertRecurringVisitPlanHistory({
    recurringVisitPlanId: plan.id,
    recurringScheduleId: plan.recurringScheduleId,
    visitNumber: plan.visitNumber,
    previousPlannedDate: plan.plannedDate,
    previousPlannedStartTime: plan.plannedStartTime,
    previousStatus: "planned",
    newPlannedDate: plan.plannedDate,
    newPlannedStartTime: plan.plannedStartTime,
    newStatus: "linked",
    changeReason: "linked_to_visit",
  });

  await repo.insertServiceVisitEvent({
    serviceVisitId: visit.id,
    eventType: "requested",
    actor: "system",
    previousState: null,
    newState: {
      requestedStartAt: requestedStartAt.toISOString(),
      recurringVisitPlanId: plan.id,
      prepaidPackageId: coveringPackage?.id ?? null,
    },
    notes: null,
  });

  await syncPackagePlanFromRecurringPlan(repo, { ...plan, status: "linked", serviceVisitId: visit.id }, "linked_to_visit");

  return { visitId: visit.id, alreadyLinked: false, prepaidPackageId: coveringPackage?.id ?? null };
}
