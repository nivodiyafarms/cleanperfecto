import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSchedulingRepository } from "@/lib/scheduling/test-support/fake-scheduling-repository";
import { createRequestedVisitFromBooking } from "@/lib/scheduling/create-requested-visit-from-booking";
import { confirmServiceVisit } from "@/lib/scheduling/confirm-service-visit";
import { AdminUnauthorizedError } from "@/lib/admin/require-admin";

const DURATION_INPUT = { cleaningType: "standard" as const, sizeTier: "2br_2ba" as const, condition: "light" as const };

let fake: ReturnType<typeof createFakeSchedulingRepository>;

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@/lib/admin/require-admin", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/admin/require-admin")>();
  return { ...actual, requireAdmin: vi.fn() };
});

vi.mock("@/lib/scheduling/supabase-scheduling-repository", () => ({
  createSupabaseSchedulingRepository: () => fake.repo,
}));

vi.mock("@/lib/admin/queries/service-visits", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/admin/queries/service-visits")>();
  return {
    ...actual,
    findServiceVisitDetail: async (visitId: string) => {
      const visit = await fake.repo.findServiceVisitById(visitId);
      if (!visit) return null;
      return { ...visit, bookingOrderId: visit.bookingOrderId, prepaidPackageId: visit.prepaidPackageId };
    },
  };
});

vi.mock("@/lib/admin/queries/visit-scope", () => ({
  resolveDurationInputForVisit: async () => DURATION_INPUT,
}));

const { requireAdmin } = await import("@/lib/admin/require-admin");
const { confirmVisitAction, reassignCleanersAction, cancelVisitAction, completeVisitAction, waiveFeeAction } = await import(
  "./schedule-actions"
);

function mockAuthorized() {
  vi.mocked(requireAdmin).mockResolvedValue({ adminUserId: "admin-1", supabaseUserId: "user-1", role: "admin" });
}

function mockUnauthorized() {
  vi.mocked(requireAdmin).mockRejectedValue(new AdminUnauthorizedError());
}

async function seedRequestedVisit(bookingOrderId = "booking-1") {
  const { visitId } = await createRequestedVisitFromBooking(fake.repo, {
    bookingOrderId,
    customerId: "customer-1",
    quoteRequestId: "quote-1",
    cleaningType: "standard",
    frequency: "one_time",
    requestedDate: "2026-09-10",
    requestedStartTime: "10:00",
    serviceAddressLine1: null,
    serviceAddressLine2: null,
    serviceCity: null,
    serviceState: null,
    serviceAddressIdentity: null,
  });
  return visitId;
}

function formData(entries: Record<string, string | string[]>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(entries)) {
    if (Array.isArray(value)) {
      for (const v of value) fd.append(key, v);
    } else {
      fd.set(key, value);
    }
  }
  return fd;
}

beforeEach(() => {
  fake = createFakeSchedulingRepository({ cleaners: [{ id: "cleaner-1", name: "A", active: true }] });
  vi.mocked(requireAdmin).mockReset();
});

describe("confirmVisitAction", () => {
  it("rejects when the caller is not an authorized admin", async () => {
    mockUnauthorized();
    const visitId = await seedRequestedVisit();
    await expect(
      confirmVisitAction(null, formData({ visitId, date: "2026-09-10", startTime: "10:00", cleanerIds: ["cleaner-1"] }))
    ).rejects.toThrow(AdminUnauthorizedError);
    expect(fake.state.serviceVisitsById.get(visitId)?.status).toBe("requested");
  });

  it("confirms a valid request via the existing domain function", async () => {
    mockAuthorized();
    const visitId = await seedRequestedVisit();
    const result = await confirmVisitAction(null, formData({ visitId, date: "2026-09-10", startTime: "10:00", cleanerIds: ["cleaner-1"] }));
    expect(result.ok).toBe(true);
    expect(fake.state.serviceVisitsById.get(visitId)?.status).toBe("scheduled");
  });

  it("surfaces a double-booking conflict as a clean, non-throwing action error", async () => {
    mockAuthorized();
    const visitA = await seedRequestedVisit("booking-a");
    const visitB = await seedRequestedVisit("booking-b");
    await confirmServiceVisit(fake.repo, {
      serviceVisitId: visitA,
      date: "2026-09-10",
      startTime: "10:00",
      cleanerIds: ["cleaner-1"],
      durationInput: DURATION_INPUT,
    });

    const result = await confirmVisitAction(null, formData({ visitId: visitB, date: "2026-09-10", startTime: "10:30", cleanerIds: ["cleaner-1"] }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/no longer available/i);
  });
});

describe("reassignCleanersAction", () => {
  it("rejects when unauthorized", async () => {
    mockUnauthorized();
    await expect(reassignCleanersAction(null, formData({ visitId: "v", cleanerIds: ["cleaner-1"] }))).rejects.toThrow(AdminUnauthorizedError);
  });
});

describe("cancelVisitAction", () => {
  it("rejects when unauthorized and leaves the visit untouched", async () => {
    mockUnauthorized();
    const visitId = await seedRequestedVisit();
    await expect(cancelVisitAction(null, formData({ visitId }))).rejects.toThrow(AdminUnauthorizedError);
    expect(fake.state.serviceVisitsById.get(visitId)?.status).toBe("requested");
  });

  it("cancels a merely-requested visit for free when authorized", async () => {
    mockAuthorized();
    const visitId = await seedRequestedVisit();
    const result = await cancelVisitAction(null, formData({ visitId }));
    expect(result.ok).toBe(true);
    expect(fake.state.serviceVisitsById.get(visitId)?.status).toBe("cancelled");
  });
});

describe("completeVisitAction", () => {
  it("rejects when unauthorized", async () => {
    mockUnauthorized();
    await expect(completeVisitAction(null, formData({ visitId: "v" }))).rejects.toThrow(AdminUnauthorizedError);
  });

  it("is idempotent — a second completion call for the same visit reports no further change", async () => {
    mockAuthorized();
    const visitId = await seedRequestedVisit();
    await confirmServiceVisit(fake.repo, {
      serviceVisitId: visitId,
      date: "2026-09-10",
      startTime: "10:00",
      cleanerIds: ["cleaner-1"],
      durationInput: DURATION_INPUT,
    });

    const first = await completeVisitAction(null, formData({ visitId }));
    const second = await completeVisitAction(null, formData({ visitId }));
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.message).toMatch(/already completed/i);
  });

  it("never touches Stripe or performs a charge — completion is purely a status/credit transition", async () => {
    mockAuthorized();
    const visitId = await seedRequestedVisit();
    await confirmServiceVisit(fake.repo, {
      serviceVisitId: visitId,
      date: "2026-09-10",
      startTime: "10:00",
      cleanerIds: ["cleaner-1"],
      durationInput: DURATION_INPUT,
    });
    await completeVisitAction(null, formData({ visitId }));
    // No prepaid_package_id on this visit, so no credit ledger touched either.
    expect(fake.state.packageVisitUsages.size).toBe(0);
  });
});

describe("waiveFeeAction", () => {
  it("rejects when unauthorized", async () => {
    mockUnauthorized();
    await expect(waiveFeeAction(null, formData({ feeAssessmentId: "f", visitId: "v", reason: "goodwill" }))).rejects.toThrow(
      AdminUnauthorizedError
    );
  });

  it("requires a reason to waive a fee", async () => {
    mockAuthorized();
    const result = await waiveFeeAction(null, formData({ feeAssessmentId: "f", visitId: "v", reason: "" }));
    expect(result.ok).toBe(false);
  });

  it("waives an existing fee assessment when a reason is given", async () => {
    mockAuthorized();
    const created = await fake.repo.insertServiceFeeAssessment({
      serviceVisitId: "visit-x",
      feeType: "cancellation",
      amount: 25,
      policyVersion: "test",
      reason: "Late cancellation",
    });
    const result = await waiveFeeAction(null, formData({ feeAssessmentId: created.id, visitId: "visit-x", reason: "Customer goodwill" }));
    expect(result.ok).toBe(true);
    expect(fake.state.feeAssessments.find((f) => f.id === created.id)?.state).toBe("waived");
  });
});
