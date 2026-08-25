import { enqueueNotification } from "@/lib/notifications/enqueue-notification";
import { getGoogleReviewUrl } from "@/lib/notifications/google-review-url";
import type { SchedulingRepository } from "@/lib/scheduling/repository";
import { computeReviewRequestSendAt } from "./review-timing";

const REVIEW_COOLDOWN_DAYS = 180;

export interface EnqueueReviewRequestInput {
  serviceVisitId: string;
  customerId: string;
  completedAtUtc: Date;
  timezone: string;
  /** service_visits.review_request_suppressed — an admin override for a problem/unhappy visit. */
  reviewRequestSuppressed: boolean;
}

export type EnqueueReviewRequestOutcome =
  | { enqueued: true }
  | { enqueued: false; reason: "suppressed" | "cooldown_active" | "google_review_url_not_configured" };

/**
 * The one place a review_request gets enqueued — called from
 * complete-service-visit.ts's existing `if (changed)` branch, so it is
 * structurally impossible before a genuine completion and structurally
 * impossible for a cancelled/no-access visit (those code paths never call
 * it). Idempotent via the same enqueueNotification path as every other
 * type (serviceVisitId:review_request:email:v1) — a completion retry can
 * never duplicate it.
 *
 * Never touches package credit, visit pricing, payment state, or
 * recurring scheduling — this function only ever reads
 * service_visit_notifications and writes one more row to it.
 */
export async function enqueueReviewRequest(repo: SchedulingRepository, input: EnqueueReviewRequestInput): Promise<EnqueueReviewRequestOutcome> {
  if (input.reviewRequestSuppressed) {
    return { enqueued: false, reason: "suppressed" };
  }

  // Scoped to state='sent' only — a merely pending/queued or failed/
  // cancelled attempt never actually reached the customer, so it must
  // never start the cooldown (see the repository method's own doc comment).
  const mostRecentSentAt = await repo.findMostRecentSentReviewRequestAt(input.customerId);
  if (mostRecentSentAt) {
    const cooldownEndsAt = new Date(mostRecentSentAt.getTime() + REVIEW_COOLDOWN_DAYS * 24 * 60 * 60 * 1000);
    if (cooldownEndsAt.getTime() > Date.now()) {
      return { enqueued: false, reason: "cooldown_active" };
    }
  }

  if (!getGoogleReviewUrl()) {
    return { enqueued: false, reason: "google_review_url_not_configured" };
  }

  const scheduledSendAt = computeReviewRequestSendAt(input.completedAtUtc, input.timezone);
  await enqueueNotification(repo, {
    serviceVisitId: input.serviceVisitId,
    customerId: input.customerId,
    notificationType: "review_request",
    channel: "email",
    scheduledSendAt,
    versionKey: "v1",
  });

  return { enqueued: true };
}
