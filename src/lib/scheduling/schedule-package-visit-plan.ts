import type { CleaningType } from "@/lib/pricing/types";
import { InvalidVisitStateError } from "./errors";
import type { SchedulingRepository } from "./repository";
import { zonedDateTimeToUtc } from "./timezone";

const DEFAULT_TIMEZONE = "America/Chicago";

export interface SchedulePackageVisitPlanInput {
  packageVisitPlanId: string;
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
 * Turns a planning-stage package_visit_plans row into a real 'requested'
 * service_visits row — this, and only this, is what "operationally
 * scheduled" means for a package visit (see package_visit_plans' own
 * comment: never represented as completed while merely planned).
 * Idempotent: a plan already 'linked' to a service_visit returns that
 * existing visit rather than creating a second one.
 */
export async function schedulePackageVisitPlan(
  repo: SchedulingRepository,
  input: SchedulePackageVisitPlanInput
): Promise<{ visitId: string; alreadyLinked: boolean }> {
  const plan = await repo.findPackageVisitPlanById(input.packageVisitPlanId);
  if (!plan) {
    throw new InvalidVisitStateError(`package_visit_plan ${input.packageVisitPlanId} not found`);
  }
  if (plan.status === "linked" && plan.serviceVisitId) {
    return { visitId: plan.serviceVisitId, alreadyLinked: true };
  }

  const timezone = input.timezone ?? DEFAULT_TIMEZONE;
  const requestedStartAt = zonedDateTimeToUtc(plan.plannedDate, plan.plannedStartTime, timezone);

  const visit = await repo.insertServiceVisit({
    customerId: input.customerId,
    quoteRequestId: null,
    bookingOrderId: null,
    prepaidPackageId: plan.prepaidPackageId,
    recurringScheduleId: plan.generatedFromRecurringScheduleId,
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

  await repo.updatePackageVisitPlan(plan.id, { status: "linked", serviceVisitId: visit.id });

  await repo.insertPackageVisitPlanHistory({
    packageVisitPlanId: plan.id,
    prepaidPackageId: plan.prepaidPackageId,
    visitNumber: plan.visitNumber,
    previousPlannedDate: plan.plannedDate,
    previousPlannedStartTime: plan.plannedStartTime,
    previousStatus: "planned",
    newPlannedDate: plan.plannedDate,
    newPlannedStartTime: plan.plannedStartTime,
    newStatus: "linked",
    changeReason: "linked_to_visit",
    packageAmendmentId: null,
  });

  await repo.insertServiceVisitEvent({
    serviceVisitId: visit.id,
    eventType: "requested",
    actor: "system",
    previousState: null,
    newState: { requestedStartAt: requestedStartAt.toISOString(), packageVisitPlanId: plan.id },
    notes: null,
  });

  return { visitId: visit.id, alreadyLinked: false };
}
