import { assessFee, type FeeAssessmentResult } from "./assess-cancellation-fee";
import { InvalidVisitStateError } from "./errors";
import type { SchedulingRepository } from "./repository";
import { cancelPendingReminder } from "./schedule-visit-reminder";

export interface CancelServiceVisitInput {
  serviceVisitId: string;
  /** The instant cancellation is being requested, for fee-notice calculation. */
  now: Date;
  /** True when the cleaner was already dispatched / access was denied — always assesses the flat dispatched/no-access fee regardless of notice. */
  noAccess?: boolean;
  reason?: string;
  actor?: string;
}

export interface CancelServiceVisitResult {
  /** False when the visit was already completed/cancelled — a safe idempotent no-op, not an error. */
  changed: boolean;
  fee: FeeAssessmentResult | null;
}

/**
 * Cancels a visit. Never consumes a package credit (package credit
 * consumption happens exclusively via complete_service_visit()). A visit
 * that was only ever 'requested' (never confirmed) cancels free — there is
 * no confirmed time to assess notice against. A 'scheduled' visit is fee-
 * assessed per the approved policy from notice given before its confirmed
 * start.
 */
export async function cancelServiceVisit(repo: SchedulingRepository, input: CancelServiceVisitInput): Promise<CancelServiceVisitResult> {
  const visit = await repo.findServiceVisitById(input.serviceVisitId);
  if (!visit) {
    throw new InvalidVisitStateError(`service_visit ${input.serviceVisitId} not found`);
  }

  const previousStatus = visit.status;
  const changed = await repo.cancelServiceVisit(input.serviceVisitId);
  if (!changed) {
    return { changed: false, fee: null };
  }

  let fee: FeeAssessmentResult | null = null;
  if (previousStatus === "scheduled" && visit.confirmedStartAt) {
    const feeType = input.noAccess ? "no_access" : "cancellation";
    const assessed = assessFee(feeType, input.now, visit.confirmedStartAt);
    if (assessed.amount > 0) {
      await repo.insertServiceFeeAssessment({
        serviceVisitId: input.serviceVisitId,
        feeType: assessed.feeType,
        amount: assessed.amount,
        policyVersion: assessed.policyVersion,
        reason: input.reason ?? null,
      });
      fee = assessed;
    }
  }

  await repo.insertServiceVisitEvent({
    serviceVisitId: input.serviceVisitId,
    eventType: input.noAccess ? "no_access_recorded" : "cancelled",
    actor: input.actor ?? null,
    previousState: { status: previousStatus },
    newState: { status: "cancelled" },
    notes: input.reason ?? null,
  });

  await cancelPendingReminder(repo, input.serviceVisitId);

  return { changed: true, fee };
}
