import { createSupabaseGoogleReviewsRepository } from "@/lib/google-reviews/repository";
import { getGoogleReviewsListingUrl } from "@/lib/google-reviews/config";
import GoogleReviewsCarousel from "./GoogleReviewsCarousel";

/**
 * Server Component: reads exclusively through the public_* views
 * (getFeaturedReviews / getPublicRatingSummary in repository.ts) — never
 * the raw tables — so content older than the 30-day retention window is
 * excluded at the query layer, not just by a check here. Renders nothing
 * at all — not an empty section, not an error message — until at least
 * one featured review is both selected by the admin AND still within the
 * retention window, per "keep the homepage section hidden until real
 * reviews are successfully synced and featured reviews are selected." A
 * Supabase failure here must not break the homepage, so any error is
 * swallowed the same way: render nothing.
 */
export default async function GoogleReviewsSection() {
  let reviews;
  let rating;

  try {
    const repo = createSupabaseGoogleReviewsRepository();
    [reviews, rating] = await Promise.all([repo.getFeaturedReviews(), repo.getPublicRatingSummary()]);
  } catch {
    return null;
  }

  if (reviews.length === 0 || rating === null) {
    return null;
  }

  const listingUrl = getGoogleReviewsListingUrl();

  return (
    <GoogleReviewsCarousel reviews={reviews} overallRating={rating.overallRating} totalReviewCount={rating.totalReviewCount} listingUrl={listingUrl} />
  );
}
