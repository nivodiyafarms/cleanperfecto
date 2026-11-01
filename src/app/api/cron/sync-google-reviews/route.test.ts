import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GOOGLE_REVIEWS_ROUTE_MAX_DURATION_SECONDS } from "@/lib/google-reviews/limits";

vi.mock("@/lib/google-reviews/config", () => ({
  getGoogleBusinessProfileConfig: vi.fn(),
}));
vi.mock("@/lib/google-reviews/client", () => ({
  createGoogleBusinessProfileReviewsClient: vi.fn(() => ({ fetchAllReviews: vi.fn() })),
}));
vi.mock("@/lib/google-reviews/repository", () => ({
  createSupabaseGoogleReviewsRepository: vi.fn(() => ({})),
}));
vi.mock("@/lib/google-reviews/sync", () => ({
  syncGoogleReviews: vi.fn(),
}));

const { getGoogleBusinessProfileConfig } = await import("@/lib/google-reviews/config");
const { syncGoogleReviews } = await import("@/lib/google-reviews/sync");
const { GET, POST, maxDuration } = await import("./route");

const SECRET = "test-cron-secret";

function post(secret: string | null): NextRequest {
  const headers = new Headers();
  if (secret !== null) headers.set("x-cron-secret", secret);
  return new NextRequest("https://preview.example/api/cron/sync-google-reviews", { method: "POST", headers });
}

beforeEach(() => {
  vi.mocked(getGoogleBusinessProfileConfig).mockReset();
  vi.mocked(syncGoogleReviews).mockReset();
  process.env.CRON_GOOGLE_REVIEWS_SYNC_SECRET = SECRET;
  vi.mocked(getGoogleBusinessProfileConfig).mockReturnValue({
    clientId: "id",
    clientSecret: "secret",
    refreshToken: "token",
    accountId: "123",
    locationId: "456",
  });
  vi.mocked(syncGoogleReviews).mockResolvedValue({
    outcome: "synced",
    reviewsFetched: 2,
    reviewsUpserted: 2,
    reviewsSkipped: 0,
    reviewsDeletedByReconciliation: 0,
    reviewsDeletedByRetentionExpiry: 0,
  });
});

afterEach(() => {
  delete process.env.CRON_GOOGLE_REVIEWS_SYNC_SECRET;
});

describe("POST /api/cron/sync-google-reviews", () => {
  it("rejects a missing secret", async () => {
    const response = await POST(post(null));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
    expect(syncGoogleReviews).not.toHaveBeenCalled();
  });

  it("rejects the wrong secret and does not echo it", async () => {
    const response = await POST(post("wrong-secret-value"));
    expect(response.status).toBe(401);
    const body = JSON.stringify(await response.json());
    expect(body).not.toContain("wrong-secret-value");
    expect(syncGoogleReviews).not.toHaveBeenCalled();
  });

  it("runs a sync for the correct secret", async () => {
    const response = await POST(post(SECRET));
    expect(response.status).toBe(200);
    expect(syncGoogleReviews).toHaveBeenCalledOnce();
    expect(await response.json()).toMatchObject({ ok: true, configured: true, outcome: "synced", reviewsFetched: 2 });
  });

  it("returns a bounded code when the sync write throws", async () => {
    vi.mocked(syncGoogleReviews).mockRejectedValue(new Error("postgres said refresh_token=super-secret-value"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await POST(post(SECRET));

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toEqual({ ok: false, error: "sync_write_failed" });
    expect(JSON.stringify(body)).not.toContain("super-secret-value");
    expect(errorSpy).toHaveBeenCalledWith("[google-reviews] sync_write_failed");
    const logged = errorSpy.mock.calls.flat().join(" ");
    expect(logged).not.toContain("super-secret-value");
    errorSpy.mockRestore();
  });
});

describe("GET /api/cron/sync-google-reviews", () => {
  it("returns 405 and does not sync, even with the correct secret", async () => {
    const response = await GET();
    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("POST");
    expect(syncGoogleReviews).not.toHaveBeenCalled();
  });

  it("uses a maxDuration inside the shared route budget", () => {
    expect(maxDuration).toBe(GOOGLE_REVIEWS_ROUTE_MAX_DURATION_SECONDS);
  });
});
