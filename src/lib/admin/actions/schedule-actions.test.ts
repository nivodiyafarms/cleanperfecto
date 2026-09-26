import { beforeEach, describe, expect, it, vi } from "vitest";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { getURLFromRedirectError } from "next/dist/client/components/redirect";
import { createFakeSchedulingRepository } from "@/lib/scheduling/test-support/fake-scheduling-repository";
import { createRequestedVisitFromBooking } from "@/lib/scheduling/create-requested-visit-from-booking";
import { confirmServiceVisit } from "@/lib/scheduling/confirm-service-visit";
import { AdminUnauthorizedError } from "@/lib/admin/require-admin";
import { AdminForbiddenError } from "@/lib/admin/rbac/capabilities";

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

// Every day of week, wide hours — confirmVisitAction now re-validates
// against the real availability engine (requireAvailabilityCheck: true),
// so a cleaner with zero declared hours would fail every confirmation
// regardless of date. A real cleaner always has real hours; this fixture
// just avoids pinning the test to one specific date's day-of-week.
const ALL_DAY_AVAILABILITY_RULES = Array.from({ length: 7 }, (_, dayOfWeek) => ({
  id: `rule-${dayOfWeek}`,
  cleanerId: "cleaner-1",
  dayOfWeek,
  startTime: "00:00",
  endTime: "23:59",
  active: true,
}));

beforeEach(() => {
  fake = createFakeSchedulingRepository({
    cleaners: [{ id: "cleaner-1", name: "A", active: true }],
    availabilityRules: ALL_DAY_AVAILABILITY_RULES,
  });
  vi.mocked(requireAdmin).mockReset();
});

/** A successful confirmVisitAction redirects rather than returning an ActionResult — see its own doc comment for why. */
async function expectRedirectToVisitPage(action: Promise<unknown>, visitId: string): Promise<void> {
  try {
    await action;
    throw new Error("expected confirmVisitAction to redirect, but it returned normally");
  } catch (error) {
    if (!isRedirectError(error)) throw error;
    expect(getURLFromRedirectError(error)).toBe(`/admin/visits/${visitId}`);
  }
}

describe("confirmVisitAction", () => {
  it("rejects when the caller is not an authorized admin", async () => {
    mockUnauthorized();
    const visitId = await seedRequestedVisit();
    await expect(
      confirmVisitAction(null, formData({ visitId, date: "2026-09-10", startTime: "10:00", cleanerIds: ["cleaner-1"] }))
    ).rejects.toThrow(AdminUnauthorizedError);
    expect(fake.state.serviceVisitsById.get(visitId)?.status).toBe("requested");
  });

  it("confirms a valid request via the existing domain function and redirects to the confirmed visit page", async () => {
    mockAuthorized();
    const visitId = await seedRequestedVisit();

    await expectRedirectToVisitPage(
      confirmVisitAction(null, formData({ visitId, date: "2026-09-10", startTime: "10:00", cleanerIds: ["cleaner-1"] })),
      visitId
    );

    expect(fake.state.serviceVisitsById.get(visitId)?.status).toBe("scheduled");
  });

  it("confirms a genuinely custom (non-grid) start time and redirects — commit 8aca883's custom-time path still works end to end", async () => {
    mockAuthorized();
    const visitId = await seedRequestedVisit();

    await expectRedirectToVisitPage(
      confirmVisitAction(null, formData({ visitId, date: "2026-09-10", startTime: "16:30", cleanerIds: ["cleaner-1"] })),
      visitId
    );

    const visit = fake.state.serviceVisitsById.get(visitId);
    expect(visit?.status).toBe("scheduled");
    expect(visit?.confirmedStartAt).not.toBeNull();
  });

  it("a genuinely invalid custom time (cleaner unavailable) is still rejected with a real error, never a redirect", async () => {
    mockAuthorized();
    // Replace the wide-open fixture with a cleaner who has no availability rule at all today.
    fake = createFakeSchedulingRepository({ cleaners: [{ id: "cleaner-1", name: "A", active: true }] });
    const visitId = await seedRequestedVisit();

    const result = await confirmVisitAction(null, formData({ visitId, date: "2026-09-10", startTime: "16:30", cleanerIds: ["cleaner-1"] }));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/not available/i);
    expect(fake.state.serviceVisitsById.get(visitId)?.status).toBe("requested");
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

    // Now caught by confirmVisitAction's authoritative pre-check (the same
    // engine that renders availability on the request detail page) rather
    // than falling through to the DB exclusion constraint — a more
    // specific, earlier reason for the same correct rejection.
    const result = await confirmVisitAction(null, formData({ visitId: visitB, date: "2026-09-10", startTime: "10:30", cleanerIds: ["cleaner-1"] }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/not available/i);
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
  async function seedFee(overrides: Partial<Parameters<typeof fake.repo.insertServiceFeeAssessment>[0]> = {}) {
    return fake.repo.insertServiceFeeAssessment({
      serviceVisitId: "visit-x",
      feeType: "cancellation",
      amount: 25,
      policyVersion: "test",
      reason: "Late cancellation",
      ...overrides,
    });
  }

  it("rejects when unauthorized (D)", async () => {
    mockUnauthorized();
    await expect(waiveFeeAction(null, formData({ feeAssessmentId: "f", visitId: "v", reason: "goodwill" }))).rejects.toThrow(
      AdminUnauthorizedError
    );
    expect(fake.state.financialAuditLog).toHaveLength(0);
  });

  it("requires a reason to waive a fee", async () => {
    mockAuthorized();
    const result = await waiveFeeAction(null, formData({ feeAssessmentId: "f", visitId: "v", reason: "" }));
    expect(result.ok).toBe(false);
    expect(fake.state.financialAuditLog).toHaveLength(0);
  });

  it("owner_admin: waives an existing fee assessment and persists actor audit atomically (A, F)", async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ adminUserId: "owner-1", supabaseUserId: "user-owner", role: "owner_admin" });
    const created = await seedFee();
    const result = await waiveFeeAction(null, formData({ feeAssessmentId: created.id, visitId: "visit-x", reason: "Customer goodwill" }));
    expect(result.ok).toBe(true);
    expect(fake.state.feeAssessments.find((f) => f.id === created.id)?.state).toBe("waived");

    expect(fake.state.financialAuditLog).toHaveLength(1);
    const audit = fake.state.financialAuditLog[0];
    expect(audit.actorAdminUserId).toBe("owner-1");
    expect(audit.actorRole).toBe("owner_admin");
    expect(audit.actionType).toBe("fee_waived");
    expect(audit.targetEntityType).toBe("service_fee_assessment");
    expect(audit.targetEntityId).toBe(created.id);
    expect(audit.serviceVisitId).toBe("visit-x");
    expect(audit.reason).toBe("Customer goodwill");
    expect(audit.metadata).toMatchObject({ feeType: "cancellation", amount: 25, policyVersion: "test" });
  });

  it("legacy admin: transitionally behaves the same as owner_admin (B)", async () => {
    mockAuthorized(); // role: "admin" — see mockAuthorized()
    const created = await seedFee();
    const result = await waiveFeeAction(null, formData({ feeAssessmentId: created.id, visitId: "visit-x", reason: "Customer goodwill" }));
    expect(result.ok).toBe(true);
    expect(fake.state.feeAssessments.find((f) => f.id === created.id)?.state).toBe("waived");
    expect(fake.state.financialAuditLog).toHaveLength(1);
    expect(fake.state.financialAuditLog[0]?.actorRole).toBe("admin");
  });

  it("Phase 2 RBAC: an operations-role admin CANNOT waive a fee — owner-only financial waiver (C)", async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ adminUserId: "ops-1", supabaseUserId: "user-ops", role: "operations" });
    const created = await seedFee();
    await expect(
      waiveFeeAction(null, formData({ feeAssessmentId: created.id, visitId: "visit-x", reason: "Customer goodwill" }))
    ).rejects.toThrow(AdminForbiddenError);
    expect(fake.state.feeAssessments.find((f) => f.id === created.id)?.state).not.toBe("waived");
    expect(fake.state.financialAuditLog).toHaveLength(0);
  });

  it("rolls back the waiver when the audit write fails — mutation and audit commit together or not at all (E)", async () => {
    mockAuthorized();
    const created = await seedFee();
    fake.state.financialAuditControl.simulateFailure = true;

    const result = await waiveFeeAction(null, formData({ feeAssessmentId: created.id, visitId: "visit-x", reason: "Customer goodwill" }));
    expect(result.ok).toBe(false);
    expect(fake.state.feeAssessments.find((f) => f.id === created.id)?.state).toBe("assessed");
    expect(fake.state.financialAuditLog).toHaveLength(0);
  });

  it("rejects a duplicate/replayed waiver on an already-waived fee without creating a second audit row (G)", async () => {
    mockAuthorized();
    const created = await seedFee();
    const first = await waiveFeeAction(null, formData({ feeAssessmentId: created.id, visitId: "visit-x", reason: "Customer goodwill" }));
    expect(first.ok).toBe(true);
    expect(fake.state.financialAuditLog).toHaveLength(1);

    const second = await waiveFeeAction(null, formData({ feeAssessmentId: created.id, visitId: "visit-x", reason: "Second attempt" }));
    expect(second.ok).toBe(false);
    expect(fake.state.financialAuditLog).toHaveLength(1);
    expect(fake.state.feeAssessments.find((f) => f.id === created.id)?.reason).toBe("Late cancellation — Waived: Customer goodwill");
  });
});

describe("Phase 2 RBAC: operations may perform permitted operational actions", () => {
  it("an operations-role admin CAN complete a service visit", async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ adminUserId: "ops-1", supabaseUserId: "user-ops", role: "operations" });
    const visit = await fake.repo.insertServiceVisit({
      customerId: "customer-1",
      quoteRequestId: null,
      bookingOrderId: "booking-1",
      prepaidPackageId: null,
      recurringScheduleId: null,
      visitNumber: null,
      cleaningType: "standard",
      frequency: "one_time",
      requestedStartAt: new Date(),
      timezone: "America/Chicago",
      serviceAddressLine1: "123 Main St",
      serviceAddressLine2: null,
      serviceCity: "Frisco",
      serviceState: "TX",
      serviceAddressIdentity: "75056|123 MAIN ST|",
    });
    const { confirmServiceVisit: confirm } = await import("@/lib/scheduling/confirm-service-visit");
    await confirm(fake.repo, {
      serviceVisitId: visit.id,
      date: "2026-10-01",
      startTime: "09:00",
      cleanerIds: ["cleaner-1"],
      durationInput: DURATION_INPUT,
      actor: "admin:ops-1",
    });

    const result = await completeVisitAction(null, formData({ visitId: visit.id }));
    expect(result.ok).toBe(true);
  });
});
