import ActionForm from "@/components/admin/ActionForm";
import { setFeaturedGoogleReviewsAction } from "@/lib/admin/actions/google-reviews-actions";
import { requireAdmin } from "@/lib/admin/require-admin";
import { hasCapability } from "@/lib/admin/rbac/capabilities";
import { GOOGLE_REVIEW_CONTENT_RETENTION_DAYS, getGoogleBusinessProfileConfig } from "@/lib/google-reviews/config";
import { formatGoogleReviewsAdminTimestamp } from "@/lib/google-reviews/format-admin-timestamp";
import { createSupabaseGoogleReviewsRepository } from "@/lib/google-reviews/repository";
import { isReviewEligibleForFeaturing } from "@/lib/google-reviews/retention";

export default async function AdminGoogleReviewsPage() {
  const admin = await requireAdmin();
  const canManageFeatured = hasCapability(admin.role, "manage_featured_google_reviews");
  const configured = getGoogleBusinessProfileConfig() !== null;
  const repo = createSupabaseGoogleReviewsRepository();
  const [cachedReviews, syncState, featuredSelections] = await Promise.all([
    repo.getAllCachedReviews(),
    repo.getSyncState(),
    repo.getFeaturedReviewSelections(),
  ]);

  const now = new Date();
  const orderByReviewId = new Map(featuredSelections.map((f) => [f.reviewId, f.displayOrder]));
  const reviewList = (
    <ul className="divide-y divide-border">
      {cachedReviews.map((review) => {
        const eligible = isReviewEligibleForFeaturing(review, syncState.lastSuccessfulSyncAt, now, GOOGLE_REVIEW_CONTENT_RETENTION_DAYS);
        return (
          <li key={review.id} className="flex items-start justify-between gap-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="font-medium text-foreground">
                {review.reviewerDisplayName}{" "}
                <span aria-label={`${review.starRating} out of 5 stars`} className="text-secondary">
                  {"★".repeat(review.starRating)}
                  {"☆".repeat(5 - review.starRating)}
                </span>
              </p>
              <p className="mt-0.5 line-clamp-2 text-sm text-muted">{review.reviewText ?? "(no written review)"}</p>
              <p className="mt-0.5 text-xs text-muted">{formatGoogleReviewsAdminTimestamp(review.reviewCreatedAt)}</p>
              {!eligible && <p className="mt-0.5 text-xs text-muted">Not eligible to feature until a successful sync validates it.</p>}
            </div>
            {canManageFeatured && eligible && (
              <div>
                <label htmlFor={`order-${review.id}`} className="block text-xs font-medium text-muted">
                  Order
                </label>
                <input
                  id={`order-${review.id}`}
                  name={`order-${review.id}`}
                  type="number"
                  min={1}
                  max={5}
                  defaultValue={orderByReviewId.get(review.id) ?? ""}
                  className="mt-1 w-16 rounded-lg border border-border px-2 py-1.5 text-sm"
                />
              </div>
            )}
            {canManageFeatured && !eligible && orderByReviewId.has(review.id) && (
              <p className="text-xs text-muted">Featured order {orderByReviewId.get(review.id)} will be cleared on the next save.</p>
            )}
          </li>
        );
      })}
    </ul>
  );

  return (
    <div className="max-w-3xl">
      <h1 className="text-xl font-semibold text-foreground">Google Reviews</h1>
      <p className="mt-1 text-sm text-muted">
        Pick up to 5 synced reviews to feature on the homepage, and set their display order. Google selects which reviews the API
        returns — this list is not every review, and not necessarily the newest.
      </p>

      <div className="mt-6 rounded-2xl border border-border bg-surface p-5">
        <h2 className="text-sm font-semibold text-foreground">Sync status</h2>
        {!configured && (
          <p className="mt-2 text-sm text-amber-700">
            Google Business Profile credentials are not configured yet. The scheduled sync is inactive until they are — see
            .env.example.
          </p>
        )}
        <dl className="mt-2 grid grid-cols-2 gap-2 text-sm">
          <dt className="text-muted">Last successful sync</dt>
          <dd className="text-foreground">{formatGoogleReviewsAdminTimestamp(syncState.lastSuccessfulSyncAt)}</dd>
          <dt className="text-muted">Last sync attempt</dt>
          <dd className="text-foreground">{formatGoogleReviewsAdminTimestamp(syncState.lastSyncAttemptAt)}</dd>
          <dt className="text-muted">Overall Google rating</dt>
          <dd className="text-foreground">{syncState.overallRating ?? "—"}</dd>
          <dt className="text-muted">Total Google review count</dt>
          <dd className="text-foreground">{syncState.totalReviewCount ?? "—"}</dd>
          {syncState.lastSyncError && (
            <>
              <dt className="text-muted">Last sync error</dt>
              <dd className="text-red-600">{syncState.lastSyncError}</dd>
            </>
          )}
        </dl>
      </div>

      <div className="mt-6 rounded-2xl border border-border bg-surface p-5">
        <h2 className="text-sm font-semibold text-foreground">Synced reviews ({cachedReviews.length})</h2>
        {!canManageFeatured && (
          <p className="mt-2 text-sm text-muted">Only an owner can change which reviews are featured. This list is read-only for your role.</p>
        )}
        {cachedReviews.length === 0 ? (
          <p className="mt-2 text-sm text-muted">No reviews synced yet. The homepage section stays hidden until at least one review is synced and featured.</p>
        ) : canManageFeatured ? (
          <ActionForm action={setFeaturedGoogleReviewsAction} className="mt-4">
            {reviewList}
            <button type="submit" className="mt-4 rounded-lg bg-primary px-4 py-1.5 text-sm font-semibold text-white hover:opacity-90">
              Save featured reviews
            </button>
          </ActionForm>
        ) : (
          <div className="mt-4">{reviewList}</div>
        )}
      </div>
    </div>
  );
}
