"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin, AdminUnauthorizedError } from "@/lib/admin/require-admin";
import { AdminForbiddenError, assertCapability } from "@/lib/admin/rbac/capabilities";
import { GOOGLE_REVIEW_CONTENT_RETENTION_DAYS } from "@/lib/google-reviews/config";
import { featuredReviewsLogFields } from "@/lib/google-reviews/featured-write-error";
import { createSupabaseGoogleReviewsRepository } from "@/lib/google-reviews/repository";
import { isReviewEligibleForFeaturing } from "@/lib/google-reviews/retention";
import { actionError, actionOk, type ActionResult } from "./types";

const MAX_FEATURED_REVIEWS = 5;

/**
 * Protects the mutation itself, not just the /admin/google-reviews page.
 * requireAdmin() plus the owner-only manage_featured_google_reviews
 * capability. The database write is one transaction (set_featured_google_reviews),
 * so a failed save leaves the previous selection in place. An empty
 * submission clears the featured set.
 */
export async function setFeaturedGoogleReviewsAction(_prevState: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const admin = await requireAdmin();
  assertCapability(admin.role, "manage_featured_google_reviews");

  const requested: { reviewId: string; displayOrder: number }[] = [];
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("order-")) continue;
    const raw = String(value).trim();
    if (!raw) continue;

    const displayOrder = Number(raw);
    if (!Number.isInteger(displayOrder) || displayOrder < 1 || displayOrder > MAX_FEATURED_REVIEWS) {
      return actionError(`Order must be a whole number from 1 to ${MAX_FEATURED_REVIEWS}.`);
    }
    requested.push({ reviewId: key.slice("order-".length), displayOrder });
  }

  if (requested.length > MAX_FEATURED_REVIEWS) {
    return actionError(`Choose at most ${MAX_FEATURED_REVIEWS} featured reviews.`);
  }
  const reviewIds = requested.map((selection) => selection.reviewId);
  const orderValues = requested.map((selection) => selection.displayOrder);
  if (new Set(reviewIds).size !== reviewIds.length) {
    return actionError("Each featured review can only be selected once.");
  }
  if (new Set(orderValues).size !== orderValues.length) {
    return actionError("Each featured review needs a unique order position.");
  }

  const repo = createSupabaseGoogleReviewsRepository();
  const [cached, syncState] = await Promise.all([repo.getAllCachedReviews(), repo.getSyncState()]);
  const now = new Date();
  const eligibleIds = new Set(
    cached
      .filter((review) => isReviewEligibleForFeaturing(review, syncState.lastSuccessfulSyncAt, now, GOOGLE_REVIEW_CONTENT_RETENTION_DAYS))
      .map((review) => review.id)
  );
  if (requested.some((selection) => !eligibleIds.has(selection.reviewId))) {
    return actionError("One or more selected reviews are no longer eligible — refresh and try again.");
  }

  try {
    await repo.setFeaturedReviews(requested);
  } catch (error) {
    if (error instanceof AdminForbiddenError || error instanceof AdminUnauthorizedError) throw error;
    const fields = featuredReviewsLogFields(error);
    console.error("[google-reviews] setFeaturedReviews failed", fields);
    return actionError("Could not save featured reviews. The previous selection was left unchanged.");
  }

  revalidatePath("/admin/google-reviews");
  revalidatePath("/");
  return actionOk(requested.length === 0 ? "Featured reviews cleared." : "Featured reviews updated.");
}
