import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminUnauthorizedError } from "@/lib/admin/require-admin";
import { AdminForbiddenError } from "@/lib/admin/rbac/capabilities";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@/lib/admin/require-admin", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/admin/require-admin")>();
  return { ...actual, requireAdmin: vi.fn() };
});

const getAllCachedReviews = vi.fn();
const getSyncState = vi.fn();
const setFeaturedReviews = vi.fn();
vi.mock("@/lib/google-reviews/repository", () => ({
  createSupabaseGoogleReviewsRepository: () => ({ getAllCachedReviews, getSyncState, setFeaturedReviews }),
}));

const { requireAdmin } = await import("@/lib/admin/require-admin");
const { setFeaturedGoogleReviewsAction } = await import("./google-reviews-actions");

const SYNCED_AT = "2026-10-31T00:00:00.000Z";

function mockOwner() {
  vi.mocked(requireAdmin).mockResolvedValue({ adminUserId: "admin-1", supabaseUserId: "user-1", role: "owner_admin" });
}
function mockOperations() {
  vi.mocked(requireAdmin).mockResolvedValue({ adminUserId: "admin-2", supabaseUserId: "user-2", role: "operations" });
}
function mockUnauthenticated() {
  vi.mocked(requireAdmin).mockImplementation(() => {
    const error = new Error("NEXT_REDIRECT");
    (error as Error & { digest: string }).digest = "NEXT_REDIRECT;replace;/admin/login;307;";
    throw error;
  });
}

function formData(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(entries)) fd.set(key, value);
  return fd;
}

function cached(ids: string[]) {
  return ids.map((id) => ({ id, lastSeenAt: SYNCED_AT }));
}

beforeEach(() => {
  vi.mocked(requireAdmin).mockReset();
  getAllCachedReviews.mockReset();
  getSyncState.mockReset();
  setFeaturedReviews.mockReset();
  getAllCachedReviews.mockResolvedValue(cached(["r1", "r2", "r3"]));
  getSyncState.mockResolvedValue({
    overallRating: 5,
    totalReviewCount: 3,
    lastSuccessfulSyncAt: SYNCED_AT,
    lastSyncAttemptAt: SYNCED_AT,
    lastSyncError: null,
  });
  vi.useFakeTimers();
  vi.setSystemTime(new Date(SYNCED_AT));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("setFeaturedGoogleReviewsAction", () => {
  it("lets an owner save a valid selection", async () => {
    mockOwner();
    const result = await setFeaturedGoogleReviewsAction(null, formData({ "order-r1": "1", "order-r2": "2" }));
    expect(result.ok).toBe(true);
    expect(setFeaturedReviews).toHaveBeenCalledWith([
      { reviewId: "r1", displayOrder: 1 },
      { reviewId: "r2", displayOrder: 2 },
    ]);
  });

  it("rejects an operations admin before touching the repository", async () => {
    mockOperations();
    await expect(setFeaturedGoogleReviewsAction(null, formData({ "order-r1": "1" }))).rejects.toThrow(AdminForbiddenError);
    expect(setFeaturedReviews).not.toHaveBeenCalled();
  });

  it("rejects an unauthenticated caller before touching the repository", async () => {
    mockUnauthenticated();
    await expect(setFeaturedGoogleReviewsAction(null, formData({ "order-r1": "1" }))).rejects.toThrow(/NEXT_REDIRECT/);
    expect(setFeaturedReviews).not.toHaveBeenCalled();
  });

  it("rejects an authenticated non-admin before touching the repository", async () => {
    vi.mocked(requireAdmin).mockRejectedValue(new AdminUnauthorizedError());
    await expect(setFeaturedGoogleReviewsAction(null, formData({ "order-r1": "1" }))).rejects.toThrow(AdminUnauthorizedError);
    expect(setFeaturedReviews).not.toHaveBeenCalled();
  });

  it("rejects an order value outside 1-5", async () => {
    mockOwner();
    const result = await setFeaturedGoogleReviewsAction(null, formData({ "order-r1": "6" }));
    expect(result.ok).toBe(false);
    expect(setFeaturedReviews).not.toHaveBeenCalled();
  });

  it("rejects duplicate order positions", async () => {
    mockOwner();
    const result = await setFeaturedGoogleReviewsAction(null, formData({ "order-r1": "1", "order-r2": "1" }));
    expect(result.ok).toBe(false);
    expect(setFeaturedReviews).not.toHaveBeenCalled();
  });

  it("rejects more than 5 featured reviews", async () => {
    mockOwner();
    getAllCachedReviews.mockResolvedValue(cached(["r1", "r2", "r3", "r4", "r5", "r6"]));
    const result = await setFeaturedGoogleReviewsAction(
      null,
      formData({ "order-r1": "1", "order-r2": "2", "order-r3": "3", "order-r4": "4", "order-r5": "5", "order-r6": "5" })
    );
    expect(result.ok).toBe(false);
  });

  it("rejects a review id that is no longer in the synced cache", async () => {
    mockOwner();
    getAllCachedReviews.mockResolvedValue(cached(["r1"]));
    const result = await setFeaturedGoogleReviewsAction(null, formData({ "order-stale-id": "1" }));
    expect(result.ok).toBe(false);
    expect(setFeaturedReviews).not.toHaveBeenCalled();
  });

  it("rejects a cached review the latest sync did not validate", async () => {
    mockOwner();
    getAllCachedReviews.mockResolvedValue([{ id: "r1", lastSeenAt: "2026-10-01T00:00:00.000Z" }]);
    const result = await setFeaturedGoogleReviewsAction(null, formData({ "order-r1": "1" }));
    expect(result.ok).toBe(false);
    expect(setFeaturedReviews).not.toHaveBeenCalled();
  });

  it("reports a failed save without claiming the selection changed", async () => {
    mockOwner();
    setFeaturedReviews.mockRejectedValue(new Error("database down, token=should-not-leak"));
    const result = await setFeaturedGoogleReviewsAction(null, formData({ "order-r1": "1" }));
    expect(result).toEqual({ ok: false, error: "Could not save featured reviews. The previous selection was left unchanged." });
    expect(JSON.stringify(result)).not.toContain("token");
  });

  it("clears the featured set when every order field is blank", async () => {
    mockOwner();
    const result = await setFeaturedGoogleReviewsAction(null, formData({ "order-r1": "" }));
    expect(result.ok).toBe(true);
    expect(setFeaturedReviews).toHaveBeenCalledWith([]);
  });
});
