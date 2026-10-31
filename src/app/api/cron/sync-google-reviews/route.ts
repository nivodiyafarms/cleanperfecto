import "server-only";

import { NextResponse, type NextRequest } from "next/server";
import { isCronRequestAuthorized } from "@/lib/notifications/cron-auth";
import { getGoogleBusinessProfileConfig } from "@/lib/google-reviews/config";
import { createGoogleBusinessProfileReviewsClient } from "@/lib/google-reviews/client";
import { createSupabaseGoogleReviewsRepository } from "@/lib/google-reviews/repository";
import { syncGoogleReviews } from "@/lib/google-reviews/sync";
export const runtime = "nodejs";
// Must stay a literal so Next can read it, and must match GOOGLE_REVIEWS_ROUTE_MAX_DURATION_SECONDS.
export const maxDuration = 60;

/**
 * Google Business Profile reviews sync. POST only — GET must not run a
 * sync. Same shared-secret header as the other cron routes
 * (x-cron-secret). The pg_cron schedule is a manual per-environment step
 * and is not installed by a migration; see docs/google-reviews-activation.md.
 * Callers must POST. A missing Google configuration returns 200 and writes
 * nothing, so an early schedule is a no-op rather than a crash loop.
 */
export function GET(): NextResponse {
  return NextResponse.json({ error: "method_not_allowed" }, { status: 405, headers: { Allow: "POST" } });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isCronRequestAuthorized(request.headers.get("x-cron-secret"), process.env.CRON_GOOGLE_REVIEWS_SYNC_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const config = getGoogleBusinessProfileConfig();
  if (!config) {
    return NextResponse.json({ ok: true, configured: false, message: "Google Business Profile credentials are not configured — sync skipped." });
  }

  try {
    const client = createGoogleBusinessProfileReviewsClient(config);
    const repo = createSupabaseGoogleReviewsRepository();
    const result = await syncGoogleReviews(client, repo, new Date());
    return NextResponse.json({
      ok: true,
      configured: true,
      outcome: result.outcome,
      reviewsFetched: result.reviewsFetched,
      reviewsUpserted: result.reviewsUpserted,
      reviewsSkipped: result.reviewsSkipped,
      reviewsDeletedByReconciliation: result.reviewsDeletedByReconciliation,
      reviewsDeletedByRetentionExpiry: result.reviewsDeletedByRetentionExpiry,
      ...(result.error ? { error: result.error } : {}),
    });
  } catch {
    console.error("[google-reviews] sync_write_failed");
    return NextResponse.json({ ok: false, error: "sync_write_failed" }, { status: 500 });
  }
}
