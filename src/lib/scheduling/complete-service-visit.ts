import { enqueueNotification } from "@/lib/notifications/enqueue-notification";
import { enqueueReviewRequest } from "@/lib/review/enqueue-review-request";
import { replenishRecurringVisitPlans } from "./replenish-recurring-visit-plans";
import { cancelPendingReminder } from "./schedule-visit-reminder";
import type { SchedulingRepository } from "./repository";

export interface CompleteServiceVisitOptions {
  /**
   * Skip enqueuing the 'completed' customer notification for this
   * transition — used ONLY by finalize-and-send.ts, whose Finalize & Send
   * call already enqueues 'final_total_ready' immediately after this
   * function returns. Without this, a Pay Per Cleaning customer received
   * TWO post-cleaning emails ('completed' AND 'final_total_ready') for the
   * exact same event (owner-reported E2E issue, 2026-09-27). Every OTHER
   * caller (completeVisitAction's direct "Mark completed" admin button,
   * confirmFinalTotalAndPay's work_finished->completed crossing) leaves
   * this false/omitted and keeps sending 'completed' unchanged — for
   * completeVisitAction specifically, 'completed' is the ONLY post-cleaning
   * email that flow ever sends (it never runs Finalize & Send at all), so
   * removing it there would leave the customer with no notice at all.
   */
  skipCompletedNotification?: boolean;
}

/**
 * Completes a visit via the atomic complete_service_visit() Postgres
 * function (see supabase-scheduling-repository.ts / the migration) — the
 * ONLY place package credit is ever consumed, and only exactly once even
 * under a retried/duplicate call. Accepts a visit currently 'scheduled'
 * (legacy direct-completion path, e.g. the prepaid package "Mark completed"
 * button) or 'work_finished' (the Finalize & Send path — see
 * finalize-and-send.ts). Logs a 'completed' event only on the call that
 * actually performed the transition (never on an idempotent no-op retry),
 * matching this codebase's existing "only fire side effects on the run
 * that performed the real transition" convention (see
 * updateBookingOrderStatus's `changed` boolean in the booking module).
 */
export async function completeServiceVisit(
  repo: SchedulingRepository,
  serviceVisitId: string,
  actor?: string,
  options: CompleteServiceVisitOptions = {}
): Promise<boolean> {
  const before = await repo.findServiceVisitById(serviceVisitId);
  await repo.completeServiceVisitRpc(serviceVisitId);
  const after = await repo.findServiceVisitById(serviceVisitId);

  const changed = (before?.status === "scheduled" || before?.status === "work_finished") && after?.status === "completed";
  if (changed) {
    await repo.insertServiceVisitEvent({
      serviceVisitId,
      eventType: "completed",
      actor: actor ?? null,
      previousState: { status: before?.status ?? "scheduled" },
      newState: { status: "completed" },
      notes: null,
    });
    await cancelPendingReminder(repo, serviceVisitId);

    // Payments V1: completion never charges anything itself — it only
    // advances the pricing rollup from "an amount will be owed once this
    // completes" to "owed and eligible for the customer's Review Charges ->
    // Tip -> Confirm & Pay flow" (or an Admin-recorded external payment).
    // A visit with nothing base-level due (package-covered, no extras)
    // stays 'not_applicable' here — the payment/tip flow itself is gated on
    // completion + confirmed pricing, not on this rollup value, so a
    // tip-only prepaid visit still works via /my/payments regardless.
    const pricing = await repo.findServiceVisitPricingByVisitId(serviceVisitId);
    if (pricing?.paymentStatus === "awaiting_completion") {
      await repo.updateServiceVisitPricingPaymentStatus(serviceVisitId, "awaiting_payment");
    }

    if (!options.skipCompletedNotification) {
      await enqueueNotification(repo, {
        serviceVisitId,
        customerId: before.customerId,
        notificationType: "completed",
        channel: "email",
        scheduledSendAt: new Date(),
        versionKey: "v1",
      });
    }

    // Review automation: only after this GENUINE completion (this whole
    // block only runs on the transition that actually completed), never
    // for a cancelled/no-access visit (those code paths never reach here
    // at all). enqueueReviewRequest itself checks suppression, the 180-day
    // cooldown, and GOOGLE_REVIEW_URL configuration — never touches
    // package credit, pricing, or payment state.
    if (after) {
      await enqueueReviewRequest(repo, {
        serviceVisitId,
        customerId: before.customerId,
        completedAtUtc: after.completedAt ?? new Date(),
        timezone: after.timezone,
        reviewRequestSuppressed: after.reviewRequestSuppressed,
      });
    }

    // Maintain the customer's rolling six-cleaning horizon (owner-approved):
    // a completed occurrence under an active recurring relationship no
    // longer occupies a horizon slot, so top it back up. A no-op for a
    // genuinely one-off visit or a schedule that isn't 'active'
    // (paused/superseded/cancelled) — see replenish-recurring-visit-plans.ts.
    //
    // service_visits.recurring_schedule_id is null for the FIRST (direct)
    // visit of a normal booking by design (service_visits_one_direct_visit_
    // per_booking_order) even though its universal calendar slot #1 is
    // linked to it — fall back to the linked recurring_visit_plans row's
    // own recurringScheduleId so completing that very first visit still
    // replenishes the horizon.
    const recurringScheduleId = after?.recurringScheduleId ?? (await repo.findRecurringVisitPlanByServiceVisitId(serviceVisitId))?.recurringScheduleId ?? null;
    if (recurringScheduleId) {
      await replenishRecurringVisitPlans(repo, recurringScheduleId);
    }
  }

  return changed;
}
