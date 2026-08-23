import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminUnauthorizedError } from "@/lib/admin/require-admin";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@/lib/admin/require-admin", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/admin/require-admin")>();
  return { ...actual, requireAdmin: vi.fn() };
});

const { requireAdmin } = await import("@/lib/admin/require-admin");
const { addDayOverrideAction, updateDayOverrideAction } = await import("./availability-actions");

function mockAuthorized() {
  vi.mocked(requireAdmin).mockResolvedValue({ adminUserId: "admin-1", supabaseUserId: "user-1", role: "admin" });
}
function mockUnauthorized() {
  vi.mocked(requireAdmin).mockRejectedValue(new AdminUnauthorizedError());
}

function formData(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(entries)) fd.set(key, value);
  return fd;
}

beforeEach(() => {
  vi.mocked(requireAdmin).mockReset();
});

describe("availability admin actions — authorization is checked before any mutation", () => {
  it("addDayOverrideAction rejects an unauthorized caller", async () => {
    mockUnauthorized();
    await expect(addDayOverrideAction(null, formData({ overrideDate: "2026-09-07", type: "closed_all_day" }))).rejects.toThrow(
      AdminUnauthorizedError
    );
  });

  it("updateDayOverrideAction rejects an unauthorized caller", async () => {
    mockUnauthorized();
    await expect(updateDayOverrideAction(null, formData({ overrideId: "o1" }))).rejects.toThrow(AdminUnauthorizedError);
  });
});

describe("availability admin actions — input validation, and never a stored 'full' state", () => {
  it("addDayOverrideAction requires a date", async () => {
    mockAuthorized();
    const result = await addDayOverrideAction(null, formData({ type: "closed_all_day" }));
    expect(result.ok).toBe(false);
  });

  it("addDayOverrideAction requires start and end times for a partial block", async () => {
    mockAuthorized();
    const result = await addDayOverrideAction(null, formData({ overrideDate: "2026-09-08", type: "partial_block" }));
    expect(result.ok).toBe(false);
  });

  it("addDayOverrideAction rejects a partial block ending before it starts", async () => {
    mockAuthorized();
    const result = await addDayOverrideAction(
      null,
      formData({ overrideDate: "2026-09-08", type: "partial_block", blockStartTime: "12:00", blockEndTime: "08:00" })
    );
    expect(result.ok).toBe(false);
  });

  it("addDayOverrideAction rejects an invalid block type (never accepts 'full')", async () => {
    mockAuthorized();
    const result = await addDayOverrideAction(null, formData({ overrideDate: "2026-09-08", type: "full" }));
    expect(result.ok).toBe(false);
  });
});
