import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminUnauthorizedError } from "@/lib/admin/require-admin";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@/lib/admin/require-admin", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/admin/require-admin")>();
  return { ...actual, requireAdmin: vi.fn() };
});

const { requireAdmin } = await import("@/lib/admin/require-admin");
const { addCleanerAction, addAvailabilityRuleAction, addAvailabilityExceptionAction } = await import("./cleaner-actions");

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

describe("cleaner admin actions — authorization is checked before any mutation", () => {
  it("addCleanerAction rejects an unauthorized caller", async () => {
    mockUnauthorized();
    await expect(addCleanerAction(null, formData({ name: "New Cleaner" }))).rejects.toThrow(AdminUnauthorizedError);
  });

  it("addAvailabilityRuleAction rejects an unauthorized caller", async () => {
    mockUnauthorized();
    await expect(
      addAvailabilityRuleAction(null, formData({ cleanerId: "c1", dayOfWeek: "1", startTime: "08:00", endTime: "18:00" }))
    ).rejects.toThrow(AdminUnauthorizedError);
  });

  it("addAvailabilityExceptionAction rejects an unauthorized caller", async () => {
    mockUnauthorized();
    await expect(
      addAvailabilityExceptionAction(null, formData({ cleanerId: "c1", exceptionDate: "2026-09-10", type: "unavailable_all_day" }))
    ).rejects.toThrow(AdminUnauthorizedError);
  });
});

describe("cleaner admin actions — input validation (before any DB call)", () => {
  it("addCleanerAction requires a non-empty name", async () => {
    mockAuthorized();
    const result = await addCleanerAction(null, formData({ name: "" }));
    expect(result.ok).toBe(false);
  });

  it("addAvailabilityRuleAction rejects an end time before the start time", async () => {
    mockAuthorized();
    const result = await addAvailabilityRuleAction(null, formData({ cleanerId: "c1", dayOfWeek: "1", startTime: "18:00", endTime: "08:00" }));
    expect(result.ok).toBe(false);
  });

  it("addAvailabilityExceptionAction requires both times for custom_hours", async () => {
    mockAuthorized();
    const result = await addAvailabilityExceptionAction(
      null,
      formData({ cleanerId: "c1", exceptionDate: "2026-09-10", type: "custom_hours", startTime: "08:00" })
    );
    expect(result.ok).toBe(false);
  });
});
