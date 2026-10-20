import type { CleaningType } from "@/lib/pricing/types";
import { InvalidVisitStateError } from "./errors";
import type { SchedulingRepository } from "./repository";
import { zonedDateTimeToUtc } from "./timezone";

const DEFAULT_TIMEZONE = "America/Chicago";

export interface ScheduleRecurringVisitPlanInput {
  recurringVisitPlanId: string;
  /** Verified server-side (both here and, atomically, inside claimAndScheduleRecurringVisitPlan's own row-locked check) against the plan's own recurring_schedule_id — never trusted as-is. */
  recurringScheduleId: string;
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
 * Idempotent AND concurrency-safe: the entire claim — check status, insert
 * the visit, link the plan, record recurring_visit_plan_history +
 * service_visit_events, and sync any linked package_visit_plans row —
 * happens atomically inside repo.claimAndScheduleRecurringVisitPlan (a
 * single, row-locked Postgres transaction — see its own migrations). A
 * plan already 'linked', whether from a prior call or a genuinely
 * concurrent one that committed first, returns that existing visit rather
 * than ever creating a second one or re-running any of those side effects
 * — by construction, every one of them already committed together with
 * that prior claim, so there is nothing left to retry on the
 * already-linked path.
 */
export async function scheduleRecurringVisitPlan(
  repo: SchedulingRepository,
  input: ScheduleRecurringVisitPlanInput
): Promise<{ visitId: string; alreadyLinked: boolean; prepaidPackageId: string | null }> {
  // Friendly, early (non-atomic) check — the claim RPC below re-verifies
  // the same thing, atomically under its row lock, which is the actual
  // authoritative guarantee. This just gives a fast, clear error without
  // waiting on that lock for an obviously-mismatched request.
  const plan = await repo.findRecurringVisitPlanById(input.recurringVisitPlanId);
  if (!plan) {
    throw new InvalidVisitStateError(`recurring_visit_plan ${input.recurringVisitPlanId} not found`);
  }
  if (plan.recurringScheduleId !== input.recurringScheduleId || plan.customerId !== input.customerId) {
    throw new InvalidVisitStateError(`recurring_visit_plan ${input.recurringVisitPlanId} does not belong to the given schedule/customer`);
  }

  const timezone = input.timezone ?? DEFAULT_TIMEZONE;
  const requestedStartAt = zonedDateTimeToUtc(plan.plannedDate, plan.plannedStartTime, timezone);

  const coveringPackage = await repo.findActivePrepaidPackageForCustomer(input.customerId);

  const claim = await repo.claimAndScheduleRecurringVisitPlan({
    recurringVisitPlanId: input.recurringVisitPlanId,
    recurringScheduleId: input.recurringScheduleId,
    customerId: input.customerId,
    prepaidPackageId: coveringPackage?.id ?? null,
    cleaningType: input.cleaningType,
    requestedStartAt,
    timezone,
    serviceAddressLine1: input.serviceAddressLine1,
    serviceAddressLine2: input.serviceAddressLine2,
    serviceCity: input.serviceCity,
    serviceState: input.serviceState,
    serviceAddressIdentity: input.serviceAddressIdentity,
  });

  if (claim.alreadyLinked) {
    const existingVisit = await repo.findServiceVisitById(claim.visitId);
    return { visitId: claim.visitId, alreadyLinked: true, prepaidPackageId: existingVisit?.prepaidPackageId ?? null };
  }

  return { visitId: claim.visitId, alreadyLinked: false, prepaidPackageId: coveringPackage?.id ?? null };
}
