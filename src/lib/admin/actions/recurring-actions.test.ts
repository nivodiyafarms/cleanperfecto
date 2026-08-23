import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminUnauthorizedError } from "@/lib/admin/require-admin";
import { createFakeSchedulingRepository } from "@/lib/scheduling/test-support/fake-scheduling-repository";

let fake: ReturnType<typeof createFakeSchedulingRepository>;

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@/lib/admin/require-admin", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/admin/require-admin")>();
  return { ...actual, requireAdmin: vi.fn() };
});

vi.mock("@/lib/scheduling/supabase-scheduling-repository", () => ({
  createSupabaseSchedulingRepository: () => fake.repo,
}));

const { requireAdmin } = await import("@/lib/admin/require-admin");
const { editRecurringVisitDateAction, editRecurringCadenceAction, confirmVisitPricingAction } = await import("./recurring-actions");

function mockAuthorized() {
  vi.mocked(requireAdmin).mockResolvedValue({ adminUserId: "admin-1", supabaseUserId: "user-1", role: "admin" });
}
function mockUnauthorized() {
  vi.mocked(requireAdmin).mockRejectedValue(new AdminUnauthorizedError());
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
  fake = createFakeSchedulingRepository();
  vi.mocked(requireAdmin).mockReset();
});

describe("editRecurringVisitDateAction", () => {
  it("rejects when unauthorized", async () => {
    mockUnauthorized();
    await expect(
      editRecurringVisitDateAction(null, formData({ recurringVisitPlanId: "p1", date: "2026-09-20", startTime: "13:00" }))
    ).rejects.toThrow(AdminUnauthorizedError);
  });

  it("moves a still-planned occurrence using the same universal domain path the portal uses", async () => {
    mockAuthorized();
    const schedule = await fake.repo.insertRecurringSchedule({
      customerId: "customer-1",
      bookingOrderId: "booking-1",
      prepaidPackageId: null,
      cadence: "weekly",
      preferredDayOfWeek: 1,
      preferredStartTime: "10:00",
      timezone: "America/Chicago",
      effectiveFrom: "2026-08-24",
      supersedesId: null,
    });
    const { plan } = await fake.repo.insertRecurringVisitPlan({
      recurringScheduleId: schedule.id,
      customerId: "customer-1",
      visitNumber: 1,
      plannedDate: "2026-08-24",
      plannedStartTime: "10:00",
    });

    const result = await editRecurringVisitDateAction(null, formData({ recurringVisitPlanId: plan.id, date: "2026-09-01", startTime: "14:00" }));
    expect(result.ok).toBe(true);
    expect(fake.state.recurringVisitPlansById.get(plan.id)?.plannedDate).toBe("2026-09-01");
  });

  it("surfaces a friendly error for an already-linked plan instead of throwing", async () => {
    mockAuthorized();
    const schedule = await fake.repo.insertRecurringSchedule({
      customerId: "customer-1",
      bookingOrderId: "booking-1",
      prepaidPackageId: null,
      cadence: "weekly",
      preferredDayOfWeek: 1,
      preferredStartTime: "10:00",
      timezone: "America/Chicago",
      effectiveFrom: "2026-08-24",
      supersedesId: null,
    });
    const { plan } = await fake.repo.insertRecurringVisitPlan({
      recurringScheduleId: schedule.id,
      customerId: "customer-1",
      visitNumber: 1,
      plannedDate: "2026-08-24",
      plannedStartTime: "10:00",
    });
    await fake.repo.updateRecurringVisitPlan(plan.id, { status: "linked", serviceVisitId: "visit-1" });

    const result = await editRecurringVisitDateAction(null, formData({ recurringVisitPlanId: plan.id, date: "2026-09-01", startTime: "14:00" }));
    expect(result.ok).toBe(false);
  });
});

describe("editRecurringCadenceAction", () => {
  it("rejects when unauthorized", async () => {
    mockUnauthorized();
    await expect(
      editRecurringCadenceAction(
        null,
        formData({ recurringScheduleId: "s1", effectiveFromVisitNumber: "1", newCadence: "biweekly", newFirstDate: "2026-09-20", newFirstStartTime: "13:00" })
      )
    ).rejects.toThrow(AdminUnauthorizedError);
  });

  it("regenerates remaining still-planned occurrences using the same universal domain path the portal uses", async () => {
    mockAuthorized();
    const schedule = await fake.repo.insertRecurringSchedule({
      customerId: "customer-1",
      bookingOrderId: "booking-1",
      prepaidPackageId: null,
      cadence: "weekly",
      preferredDayOfWeek: 1,
      preferredStartTime: "10:00",
      timezone: "America/Chicago",
      effectiveFrom: "2026-08-24",
      supersedesId: null,
    });
    await fake.repo.insertRecurringVisitPlan({ recurringScheduleId: schedule.id, customerId: "customer-1", visitNumber: 1, plannedDate: "2026-08-24", plannedStartTime: "10:00" });
    await fake.repo.insertRecurringVisitPlan({ recurringScheduleId: schedule.id, customerId: "customer-1", visitNumber: 2, plannedDate: "2026-08-31", plannedStartTime: "10:00" });

    const result = await editRecurringCadenceAction(
      null,
      formData({ recurringScheduleId: schedule.id, effectiveFromVisitNumber: "1", newCadence: "biweekly", newFirstDate: "2026-09-20", newFirstStartTime: "13:00" })
    );
    expect(result.ok).toBe(true);
  });

  it("rejects an invalid cadence value", async () => {
    mockAuthorized();
    const result = await editRecurringCadenceAction(
      null,
      formData({ recurringScheduleId: "s1", effectiveFromVisitNumber: "1", newCadence: "monthly", newFirstDate: "2026-09-20", newFirstStartTime: "13:00" })
    );
    expect(result.ok).toBe(false);
  });
});

describe("confirmVisitPricingAction", () => {
  async function seedPpcVisitWithApprovedScope() {
    const schedule = await fake.repo.insertRecurringSchedule({
      customerId: "customer-1",
      bookingOrderId: "booking-1",
      prepaidPackageId: null,
      cadence: "weekly",
      preferredDayOfWeek: 1,
      preferredStartTime: "10:00",
      timezone: "America/Chicago",
      effectiveFrom: "2026-08-24",
      supersedesId: null,
    });
    const version = await fake.repo.insertRecurringScopeVersion({
      recurringScheduleId: schedule.id,
      customerId: "customer-1",
      baseCalculationInput: {} as never,
      approvedBaseAmount: 150,
      pricingSnapshot: null,
      effectiveFromVisitNumber: 1,
      supersedesId: null,
      requestedBy: null,
      reason: null,
    });
    await fake.repo.updateRecurringScopeVersionStatus(version.id, "active");
    const visit = await fake.repo.insertServiceVisit({
      customerId: "customer-1",
      quoteRequestId: null,
      bookingOrderId: null,
      prepaidPackageId: null,
      recurringScheduleId: schedule.id,
      visitNumber: 2,
      cleaningType: "standard",
      frequency: null,
      requestedStartAt: null,
      timezone: "America/Chicago",
      serviceAddressLine1: null,
      serviceAddressLine2: null,
      serviceCity: null,
      serviceState: null,
      serviceAddressIdentity: null,
    });
    return visit;
  }

  it("rejects when unauthorized", async () => {
    mockUnauthorized();
    await expect(confirmVisitPricingAction(null, formData({ serviceVisitId: "v1" }))).rejects.toThrow(AdminUnauthorizedError);
  });

  it("confirms the final price and tags the confirming admin", async () => {
    mockAuthorized();
    const visit = await seedPpcVisitWithApprovedScope();

    const result = await confirmVisitPricingAction(null, formData({ serviceVisitId: visit.id, addOnIds: ["inside_oven"] }));
    expect(result.ok).toBe(true);

    const pricing = fake.state.servicePricingByVisitId.get(visit.id);
    expect(pricing?.priceStatus).toBe("confirmed");
    expect(pricing?.confirmedBy).toBe("admin:admin-1");
    expect(pricing?.totalAmount).toBe(185); // 150 base + 35 inside_oven
  });

  it("requires a visit id", async () => {
    mockAuthorized();
    const result = await confirmVisitPricingAction(null, formData({}));
    expect(result.ok).toBe(false);
  });
});
