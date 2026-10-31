"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import { isAllowedReviewerPhotoUrl } from "@/lib/google-reviews/reviewer-photo-url";
import type { PublicFeaturedReview } from "@/lib/google-reviews/types";

/**
 * Policy basis (developers.google.com/my-business/content/policies,
 * reviewed 2026-10-24 — re-check before any future change here):
 *   - "It must be stored temporarily for no more than 30 calendar days."
 *     → GOOGLE_REVIEW_CONTENT_RETENTION_DAYS (config.ts) = 30, enforced
 *     independently at the DB layer (see 20261024091500_...sql).
 *   - Content "cannot be manipulated or aggregated in any way." → the
 *     rating/count shown here is always Google's own averageRating/
 *     totalReviewCount verbatim (public_google_business_profile_rating
 *     view), never recomputed from the featured subset; review text is
 *     rendered unmodified (only visually truncated with a "Read more"
 *     toggle — the full original text is always reachable, not altered).
 *   - "You must display such attribution as provided... and must not
 *     delete or alter the attribution" — reviewer name, star rating, and
 *     date are always shown per review; the Google monogram + "See all
 *     reviews on Google" link are always present when rating data renders.
 *   - "Must not replicate the look and feel of the Business Profile user
 *     interface" — these cards intentionally use CleanPerfecto's own
 *     GlassPanel/border/shadow styling and brand palette, not a copy of
 *     Google's Material-style review card.
 *
 * Unresolved — flagged for the business owner, not assumed away:
 *   1. The Google monogram below is a hand-built 4-color "G", not Google's
 *      official provided brand asset. "Attribution as provided" may mean
 *      the literal Google-supplied badge/logo asset should be used
 *      instead — source it from Google's brand resources before this
 *      ships publicly, swap it in here.
 *   2. Whether admin curation (choosing which of Google's own
 *      already-returned reviews to feature, and their order) falls under
 *      the "cannot be manipulated or aggregated" restriction is genuinely
 *      ambiguous from the policy text alone — our working interpretation
 *      is that this clause governs content/rating INTEGRITY (don't edit
 *      text, don't compute a synthetic score), not which of Google's own
 *      reviews a business chooses to surface, but this reading hasn't
 *      been confirmed against Google's fuller Business Profile Additional
 *      Terms / Business Profile API Policies (linked from, but not fully
 *      reachable/fetchable from, the policies page above).
 *   3. Deletion/display obligations specifically upon authorization
 *      revocation beyond the 30-day cap aren't spelled out on the
 *      fetchable policy page — our implementation treats "credentials
 *      removed" the same as "sync stopped" (content still expires via the
 *      independent 30-day cleanup either way), which is at least as
 *      strict as anything the policy text states, but isn't a confirmed
 *      requirement either way.
 */

const REVIEW_TEXT_COLLAPSE_LENGTH = 220;

function Stars({ rating }: { rating: number }) {
  return (
    <span aria-label={`${rating} out of 5 stars`} className="text-secondary" role="img">
      {"★".repeat(rating)}
      {"☆".repeat(5 - rating)}
    </span>
  );
}

function ReviewerInitial({ name }: { name: string }) {
  const initial = name.trim().charAt(0).toUpperCase() || "?";
  return (
    <span
      aria-hidden="true"
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/15 text-base font-semibold text-primary"
    >
      {initial}
    </span>
  );
}

function Avatar({ name, photoUrl }: { name: string; photoUrl: string | null }) {
  const [failed, setFailed] = useState(false);
  if (!failed && isAllowedReviewerPhotoUrl(photoUrl)) {
    return (
      <Image
        src={photoUrl}
        alt=""
        width={40}
        height={40}
        className="h-10 w-10 shrink-0 rounded-full object-cover"
        onError={() => setFailed(true)}
      />
    );
  }
  return <ReviewerInitial name={name} />;
}

function ReviewCard({ review }: { review: PublicFeaturedReview }) {
  const [expanded, setExpanded] = useState(false);
  const text = review.reviewText ?? "";
  const isLong = text.length > REVIEW_TEXT_COLLAPSE_LENGTH;

  return (
    <li className="flex w-full max-w-full min-w-full flex-shrink-0 snap-start flex-col rounded-3xl border border-border bg-white/80 p-6 shadow-sm shadow-foreground/5 backdrop-blur-sm sm:min-w-0 sm:basis-1/2 lg:basis-1/3">
      <div className="flex items-center gap-3">
        <Avatar name={review.reviewerDisplayName} photoUrl={review.reviewerPhotoUrl} />
        <div>
          <p className="font-semibold text-foreground">{review.reviewerDisplayName}</p>
          <p className="text-xs text-muted">
            {new Date(review.reviewCreatedAt).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })}
          </p>
        </div>
      </div>
      <div className="mt-3">
        <Stars rating={review.starRating} />
      </div>
      {text && (
        <p className="mt-3 flex-1 break-words text-sm text-muted">
          {expanded || !isLong ? text : `${text.slice(0, REVIEW_TEXT_COLLAPSE_LENGTH).trimEnd()}…`}
          {isLong && (
            <button
              type="button"
              onClick={() => setExpanded((prev) => !prev)}
              className="ml-1 font-medium text-secondary hover:underline"
            >
              {expanded ? "Show less" : "Read more"}
            </button>
          )}
        </p>
      )}
    </li>
  );
}

export default function GoogleReviewsCarousel({
  reviews,
  overallRating,
  totalReviewCount,
  listingUrl,
}: {
  reviews: PublicFeaturedReview[];
  overallRating: number;
  totalReviewCount: number;
  listingUrl: string | null;
}) {
  const trackRef = useRef<HTMLUListElement>(null);

  function scrollByOneCard(direction: 1 | -1) {
    const track = trackRef.current;
    if (!track) return;
    const firstCard = track.firstElementChild as HTMLElement | null;
    const step = (firstCard?.offsetWidth ?? track.clientWidth) + 24; // + gap-6
    track.scrollBy({ left: direction * step, behavior: "smooth" });
  }

  return (
    <section
      aria-label="Featured Google reviews"
      className="overflow-x-hidden px-6 pt-10 pb-8 sm:pt-12 sm:pb-10 lg:px-8 lg:pt-14 lg:pb-12"
    >
      <div className="mx-auto min-w-0 max-w-7xl">
        <div className="flex flex-col items-center gap-3 text-center sm:flex-row sm:items-end sm:justify-between sm:text-left">
          <div>
            <h2 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">Featured Google Reviews</h2>
            <p className="mt-2 text-muted">
              A curated selection from our verified Google Business Profile. Google determines which reviews are available to show
              here — this is not every review, and not necessarily the newest.
            </p>
          </div>
          <div className="flex items-center gap-2 text-sm text-foreground">
            <GoogleMonogram />
            <span className="font-semibold">{overallRating.toFixed(1)}</span>
            <Stars rating={Math.round(overallRating)} />
            <span className="text-muted">({totalReviewCount} reviews)</span>
          </div>
        </div>

        <div
          className="relative mt-10 min-w-0 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-secondary lg:mt-12"
          role="region"
          aria-roledescription="carousel"
          aria-label="Review cards"
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === "ArrowRight") {
              event.preventDefault();
              scrollByOneCard(1);
            } else if (event.key === "ArrowLeft") {
              event.preventDefault();
              scrollByOneCard(-1);
            }
          }}
        >
          <ul
            ref={trackRef}
            className="flex min-w-0 gap-6 overflow-x-auto scroll-smooth snap-x snap-mandatory pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {reviews.map((review) => (
              <ReviewCard key={review.id} review={review} />
            ))}
          </ul>

          <div className="mt-4 flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => scrollByOneCard(-1)}
              aria-label="Previous review"
              className="rounded-full border border-border bg-white/80 p-2 text-foreground hover:bg-background-alt"
            >
              <span aria-hidden="true">←</span>
            </button>
            <button
              type="button"
              onClick={() => scrollByOneCard(1)}
              aria-label="Next review"
              className="rounded-full border border-border bg-white/80 p-2 text-foreground hover:bg-background-alt"
            >
              <span aria-hidden="true">→</span>
            </button>
          </div>
        </div>

        {listingUrl && (
          <div className="mt-6 text-center">
            <a href={listingUrl} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold text-secondary hover:underline">
              See all reviews on Google
            </a>
          </div>
        )}
      </div>
    </section>
  );
}

function GoogleMonogram() {
  return (
    <svg aria-hidden="true" viewBox="0 0 48 48" className="h-5 w-5">
      <path fill="#4285F4" d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.09c4.15-3.82 6.58-9.44 6.58-16.17z" />
      <path fill="#34A853" d="M24 46c5.94 0 10.92-1.97 14.54-5.33l-7.09-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.32-9.07H4.34v5.7C7.95 41.07 15.34 46 24 46z" />
      <path fill="#FBBC05" d="M11.68 28.18A13.93 13.93 0 0 1 10.73 24c0-1.45.25-2.86.95-4.18v-5.7H4.34A21.93 21.93 0 0 0 2 24c0 3.55.85 6.91 2.34 9.88z" />
      <path fill="#EA4335" d="M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.3-6.3C34.91 4.18 29.93 2 24 2 15.34 2 7.95 6.93 4.34 14.12l7.34 5.7c1.74-5.2 6.59-9.07 12.32-9.07z" />
    </svg>
  );
}
