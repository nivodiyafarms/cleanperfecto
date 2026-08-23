import { calculateEstimate } from "@/lib/pricing/calculate-estimate";
import { roundToCents } from "@/lib/pricing/money";
import type { CalculationInput } from "@/lib/pricing/types";
import type { RecurringScopeVersionRow } from "./domain-types";
import { InvalidVisitStateError } from "./errors";
import type { SchedulingRepository } from "./repository";

export interface ProposeRecurringScopeChangeInput {
  recurringScheduleId: string;
  customerId: string;
  /** The full new base scope (property/rooms/condition/cleaning type/etc), server-authoritative — reused via calculateEstimate(), never invented. */
  newBaseInput: CalculationInput;
  effectiveFromVisitNumber: number;
  requestedBy?: string;
  reason?: string;
}

/**
 * Proposes a new base cleaning-scope version for a recurring relationship
 * (e.g. one more bedroom, Standard -> Deep, a persistent scope increase) —
 * kept in recurring_scope_versions, deliberately separate from
 * recurring_schedules (cadence/day/time only, never overloaded with
 * cleaning-scope history). Always a new row (supersedesId -> whatever
 * version it would replace, if any) rather than an in-place edit —
 * completed visits keep whatever scope version was active for them at the
 * time, and this history is never rewritten.
 *
 * Admin already confirms the revised scope/pricing by the act of calling
 * this (it's an admin-initiated action, same as createPackageAmendment) —
 * every proposal reflects a server-authoritative calculateEstimate() run,
 * never invented pricing. A SEPARATE customer-approval gate is layered on
 * top only when it's actually needed (owner-approved refinement):
 *
 *   - If there is no previously-active version, OR the new amount is the
 *     SAME OR LOWER than the previously-active version's approvedBaseAmount,
 *     this version activates immediately (superseding the old one) — no
 *     second customer approval merely because the scope version changed.
 *   - If the new amount is strictly HIGHER than the previously-active
 *     version's approvedBaseAmount, this version is created
 *     'pending_customer_approval' and stays inert until
 *     approve-recurring-scope-change.ts is called.
 *
 * Never silently rewrites historical pricing — a lower/equal auto-activation
 * still only affects visits estimated/scheduled AFTER this point (see
 * estimate-visit-pricing.ts), exactly like an approved increase would.
 */
export async function proposeRecurringScopeChange(
  repo: SchedulingRepository,
  input: ProposeRecurringScopeChangeInput
): Promise<RecurringScopeVersionRow> {
  const schedule = await repo.findRecurringScheduleById(input.recurringScheduleId);
  if (!schedule) {
    throw new InvalidVisitStateError(`recurring_schedule ${input.recurringScheduleId} not found`);
  }

  const currentActive = await repo.findActiveRecurringScopeVersion(input.recurringScheduleId);

  const result = calculateEstimate(input.newBaseInput);
  if (result.manualReviewRequired) {
    throw new InvalidVisitStateError(
      `Cannot compute an instant reprice for recurring_schedule ${input.recurringScheduleId}'s new scope — manual pricing review required.`
    );
  }
  const newAmount = roundToCents(result.calculatedTotal);

  const requiresCustomerApproval =
    currentActive !== null && currentActive.approvedBaseAmount !== null && newAmount > currentActive.approvedBaseAmount;

  const created = await repo.insertRecurringScopeVersion({
    recurringScheduleId: input.recurringScheduleId,
    customerId: input.customerId,
    baseCalculationInput: input.newBaseInput,
    approvedBaseAmount: newAmount,
    pricingSnapshot: { input: input.newBaseInput, result },
    effectiveFromVisitNumber: input.effectiveFromVisitNumber,
    supersedesId: currentActive?.id ?? null,
    requestedBy: input.requestedBy ?? null,
    reason: input.reason ?? null,
  });

  if (requiresCustomerApproval) {
    return created;
  }

  if (currentActive) {
    await repo.supersedeRecurringScopeVersion(currentActive.id);
  }
  const activated = await repo.updateRecurringScopeVersionStatus(created.id, "active");
  return activated ?? created;
}
