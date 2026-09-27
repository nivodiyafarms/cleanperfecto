import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSchedulingRepository } from "@/lib/scheduling/test-support/fake-scheduling-repository";
import { createFakeBookingRepository } from "@/lib/booking/test-support/fake-booking-repository";
import { proposeRecurringScopeChange } from "@/lib/scheduling/propose-recurring-scope-change";
import { estimateVisitPricing } from "@/lib/scheduling/estimate-visit-pricing";
import type { CalculationInput } from "@/lib/pricing/types";
import { AdminUnauthorizedError } from "@/lib/admin/require-admin";
import { AdminForbiddenError } from "@/lib/admin/rbac/capabilities";
import { roundToCents } from "@/lib/pricing/money";

const BASE_INPUT: CalculationInput = {
  propertyKind: "home",
  cleaningType: "standard",
  condition: "light",
  sizeTier: "2br_2ba",
  zip: "75056",
  frequency: "weekly",
  isPrepaidPackage: false,
  visitCount: 1,
  addOnIds: [],
  firstCleaningEligible: false,
  asOf: new Date("2026-08-24T00:00:00Z"),
};

let fake: ReturnType<typeof createFakeSchedulingRepository>;
let fakeBooking: ReturnType<typeof createFakeBookingRepository>;

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@/lib/admin/require-admin", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/admin/require-admin")>();
  return { ...actual, requireAdmin: vi.fn() };
});

vi.mock("@/lib/scheduling/supabase-scheduling-repository", () => ({
  createSupabaseSchedulingRepository: () => fake.repo,
}));

vi.mock("@/lib/booking/supabase-booking-repository", () => ({
  createSupabaseBookingRepository: () => fakeBooking.repo,
}));

const { requireAdmin } = await import("@/lib/admin/require-admin");
const { markWorkFinishedAction } = await import("./schedule-actions");
const { updateFinalScopeAction, finalizeAndSendAction, resendFinalTotalLinkAction, addCustomChargeAction, addCustomDiscountAction, removeCustomChargeAction, removeCustomDiscountAction } =
  await import("./finalize-send-actions");

function mockRole(role: string) {
  vi.mocked(requireAdmin).mockResolvedValue({ adminUserId: "admin-1", supabaseUserId: "user-1", role } as never);
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

async function seedScheduledPpcVisit() {
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
  await proposeRecurringScopeChange(fake.repo, {
    recurringScheduleId: schedule.id,
    customerId: "customer-1",
    newBaseInput: BASE_INPUT,
    effectiveFromVisitNumber: 1,
  });
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
  const current = fake.state.serviceVisitsById.get(visit.id)!;
  fake.state.serviceVisitsById.set(visit.id, { ...current, status: "scheduled" });
  return visit.id;
}

async function seedWorkFinishedVisit() {
  const visitId = await seedScheduledPpcVisit();
  await estimateVisitPricing(fake.repo, { serviceVisitId: visitId, addOnIds: [] });
  await fake.repo.confirmServiceVisitPricing(visitId, "admin:1");
  const current = fake.state.serviceVisitsById.get(visitId)!;
  fake.state.serviceVisitsById.set(visitId, { ...current, status: "work_finished", workFinishedAt: new Date() });
  return visitId;
}

beforeEach(() => {
  fake = createFakeSchedulingRepository();
  fakeBooking = createFakeBookingRepository();
  vi.mocked(requireAdmin).mockReset();
});

describe("markWorkFinishedAction", () => {
  it("rejects when unauthorized", async () => {
    mockUnauthorized();
    await expect(markWorkFinishedAction(null, formData({ visitId: "v" }))).rejects.toThrow(AdminUnauthorizedError);
  });

  it("rejects an unrecognized/lower-privilege role (representing a cleaner without admin access) — fails closed", async () => {
    mockRole("cleaner");
    const visitId = await seedScheduledPpcVisit();
    await expect(markWorkFinishedAction(null, formData({ visitId }))).rejects.toThrow(AdminForbiddenError);
    expect(fake.state.serviceVisitsById.get(visitId)?.status).toBe("scheduled");
  });

  it("transitions a scheduled visit to work_finished for an operations-role admin", async () => {
    mockRole("operations");
    const visitId = await seedScheduledPpcVisit();
    const result = await markWorkFinishedAction(null, formData({ visitId }));
    expect(result.ok).toBe(true);
    expect(fake.state.serviceVisitsById.get(visitId)?.status).toBe("work_finished");
  });
});

describe("updateFinalScopeAction — cleaner cannot alter price", () => {
  it("rejects an unrecognized/lower-privilege role", async () => {
    mockRole("cleaner");
    const visitId = await seedWorkFinishedVisit();
    const before = await fake.repo.findServiceVisitPricingByVisitId(visitId);
    await expect(updateFinalScopeAction(null, formData({ serviceVisitId: visitId, addOnIds: ["inside_oven"] }))).rejects.toThrow(
      AdminForbiddenError
    );
    const after = await fake.repo.findServiceVisitPricingByVisitId(visitId);
    expect(after).toEqual(before);
  });

  it("refuses to run before the visit is work-finished", async () => {
    mockRole("operations");
    const visitId = await seedScheduledPpcVisit();
    const result = await updateFinalScopeAction(null, formData({ serviceVisitId: visitId, addOnIds: [] }));
    expect(result.ok).toBe(false);
  });

  it("recomputes the estimate via structured add-ons without confirming it (Finalize & Send's job, not this action's)", async () => {
    mockRole("operations");
    const visitId = await seedWorkFinishedVisit();
    const before = await fake.repo.findServiceVisitPricingByVisitId(visitId);

    const result = await updateFinalScopeAction(null, formData({ serviceVisitId: visitId, addOnIds: ["inside_oven"] }));

    expect(result.ok).toBe(true);
    const after = await fake.repo.findServiceVisitPricingByVisitId(visitId);
    expect(after?.totalAmount).toBe((before?.totalAmount ?? 0) + 30);
    expect(after?.priceStatus).not.toBe("confirmed");
  });
});

describe("finalizeAndSendAction", () => {
  it("rejects when unauthorized", async () => {
    mockUnauthorized();
    await expect(finalizeAndSendAction(null, formData({ serviceVisitId: "v" }))).rejects.toThrow(AdminUnauthorizedError);
  });

  it("rejects a request before work is marked finished", async () => {
    mockRole("operations");
    const visitId = await seedScheduledPpcVisit();
    const result = await finalizeAndSendAction(null, formData({ serviceVisitId: visitId }));
    expect(result.ok).toBe(false);
  });

  it("finalizes and sends, completing the visit when no approval is required", async () => {
    mockRole("operations");
    const visitId = await seedWorkFinishedVisit();

    const result = await finalizeAndSendAction(null, formData({ serviceVisitId: visitId }));

    expect(result.ok).toBe(true);
    expect(fake.state.serviceVisitsById.get(visitId)?.status).toBe("completed");
  });

  it("is idempotent — a second Finalize & Send reports already-sent instead of re-sending", async () => {
    mockRole("operations");
    const visitId = await seedWorkFinishedVisit();

    await finalizeAndSendAction(null, formData({ serviceVisitId: visitId }));
    const second = await finalizeAndSendAction(null, formData({ serviceVisitId: visitId }));

    expect(second.ok).toBe(true);
    if (second.ok) expect(second.message).toMatch(/already/i);
    const notices = [...fake.state.notifications.values()].filter((n) => n.serviceVisitId === visitId && n.notificationType === "final_total_ready");
    expect(notices.length).toBe(1);
  });
});

describe("addCustomChargeAction", () => {
  it("rejects when unauthorized", async () => {
    mockUnauthorized();
    await expect(addCustomChargeAction(null, formData({ serviceVisitId: "v", description: "x", amount: "10" }))).rejects.toThrow(
      AdminUnauthorizedError
    );
  });

  it("rejects a cleaner/unrecognized role — fails closed", async () => {
    mockRole("cleaner");
    const visitId = await seedWorkFinishedVisit();
    await expect(
      addCustomChargeAction(null, formData({ serviceVisitId: visitId, description: "Extra work", amount: "45" }))
    ).rejects.toThrow(AdminForbiddenError);
  });

  it("an operations admin CAN add a custom charge — same capability as the predefined add-on checklist", async () => {
    mockRole("operations");
    const visitId = await seedWorkFinishedVisit();
    const before = await fake.repo.findServiceVisitPricingByVisitId(visitId);

    const result = await addCustomChargeAction(null, formData({ serviceVisitId: visitId, description: "Extra work", amount: "45" }));

    expect(result.ok).toBe(true);
    const after = await fake.repo.findServiceVisitPricingByVisitId(visitId);
    expect(after?.customChargeAmount).toBe(45);
    expect(after?.totalAmount).toBe((before?.totalAmount ?? 0) + 45);
  });

  it("an owner admin can also add a custom charge", async () => {
    mockRole("owner_admin");
    const visitId = await seedWorkFinishedVisit();
    const result = await addCustomChargeAction(null, formData({ serviceVisitId: visitId, description: "Extra work", amount: "45" }));
    expect(result.ok).toBe(true);
  });

  it("rejects a missing description", async () => {
    mockRole("operations");
    const visitId = await seedWorkFinishedVisit();
    const result = await addCustomChargeAction(null, formData({ serviceVisitId: visitId, description: "", amount: "45" }));
    expect(result.ok).toBe(false);
  });

  it("rejects a missing/zero/invalid amount", async () => {
    mockRole("operations");
    const visitId = await seedWorkFinishedVisit();
    const zero = await addCustomChargeAction(null, formData({ serviceVisitId: visitId, description: "Extra work", amount: "0" }));
    expect(zero.ok).toBe(false);
    const nonNumeric = await addCustomChargeAction(null, formData({ serviceVisitId: visitId, description: "Extra work", amount: "abc" }));
    expect(nonNumeric.ok).toBe(false);
    const negative = await addCustomChargeAction(null, formData({ serviceVisitId: visitId, description: "Extra work", amount: "-5" }));
    expect(negative.ok).toBe(false);
  });
});

describe("addCustomDiscountAction — owner-only financial correction", () => {
  it("rejects when unauthorized", async () => {
    mockUnauthorized();
    await expect(addCustomDiscountAction(null, formData({ serviceVisitId: "v", description: "x", amount: "10" }))).rejects.toThrow(
      AdminUnauthorizedError
    );
  });

  it("an operations admin CANNOT create a discount/credit, even via a direct action call", async () => {
    mockRole("operations");
    const visitId = await seedWorkFinishedVisit();
    const before = await fake.repo.findServiceVisitPricingByVisitId(visitId);

    await expect(
      addCustomDiscountAction(null, formData({ serviceVisitId: visitId, description: "Loyalty credit", amount: "25" }))
    ).rejects.toThrow(AdminForbiddenError);

    const after = await fake.repo.findServiceVisitPricingByVisitId(visitId);
    expect(after).toEqual(before);
  });

  it("an owner admin CAN create a discount/credit", async () => {
    mockRole("owner_admin");
    const visitId = await seedWorkFinishedVisit();
    const before = await fake.repo.findServiceVisitPricingByVisitId(visitId);

    const result = await addCustomDiscountAction(null, formData({ serviceVisitId: visitId, description: "Loyalty credit", amount: "25" }));

    expect(result.ok).toBe(true);
    const after = await fake.repo.findServiceVisitPricingByVisitId(visitId);
    expect(after?.customDiscountAmount).toBe(25);
    expect(after?.totalAmount).toBe(roundToCents((before?.totalAmount ?? 0) - 25));
  });

  it("rejects a missing description", async () => {
    mockRole("owner_admin");
    const visitId = await seedWorkFinishedVisit();
    const result = await addCustomDiscountAction(null, formData({ serviceVisitId: visitId, description: "", amount: "25" }));
    expect(result.ok).toBe(false);
  });

  it("rejects a zero/invalid amount", async () => {
    mockRole("owner_admin");
    const visitId = await seedWorkFinishedVisit();
    const zero = await addCustomDiscountAction(null, formData({ serviceVisitId: visitId, description: "Credit", amount: "0" }));
    expect(zero.ok).toBe(false);
  });
});

describe("removeCustomChargeAction", () => {
  it("rejects when unauthorized", async () => {
    mockUnauthorized();
    await expect(removeCustomChargeAction(null, formData({ serviceVisitId: "v", adjustmentId: "a" }))).rejects.toThrow(AdminUnauthorizedError);
  });

  it("an operations admin can remove a custom charge they/another operations admin added", async () => {
    mockRole("operations");
    const visitId = await seedWorkFinishedVisit();
    await addCustomChargeAction(null, formData({ serviceVisitId: visitId, description: "Extra work", amount: "45" }));
    const pricing = await fake.repo.findServiceVisitPricingByVisitId(visitId);
    const adjustmentId = pricing!.customAdjustments[0].id;

    const result = await removeCustomChargeAction(null, formData({ serviceVisitId: visitId, adjustmentId }));

    expect(result.ok).toBe(true);
    const after = await fake.repo.findServiceVisitPricingByVisitId(visitId);
    expect(after?.customChargeAmount).toBe(0);
  });
});

describe("removeCustomDiscountAction — owner-only financial correction", () => {
  it("an operations admin CANNOT remove a discount/credit, even via a direct action call", async () => {
    mockRole("owner_admin");
    const visitId = await seedWorkFinishedVisit();
    await addCustomDiscountAction(null, formData({ serviceVisitId: visitId, description: "Loyalty credit", amount: "25" }));
    const pricing = await fake.repo.findServiceVisitPricingByVisitId(visitId);
    const adjustmentId = pricing!.customAdjustments[0].id;

    mockRole("operations");
    const before = await fake.repo.findServiceVisitPricingByVisitId(visitId);
    await expect(removeCustomDiscountAction(null, formData({ serviceVisitId: visitId, adjustmentId }))).rejects.toThrow(AdminForbiddenError);
    const after = await fake.repo.findServiceVisitPricingByVisitId(visitId);
    expect(after).toEqual(before);
  });

  it("an owner admin CAN remove a discount/credit", async () => {
    mockRole("owner_admin");
    const visitId = await seedWorkFinishedVisit();
    await addCustomDiscountAction(null, formData({ serviceVisitId: visitId, description: "Loyalty credit", amount: "25" }));
    const pricing = await fake.repo.findServiceVisitPricingByVisitId(visitId);
    const adjustmentId = pricing!.customAdjustments[0].id;

    const result = await removeCustomDiscountAction(null, formData({ serviceVisitId: visitId, adjustmentId }));

    expect(result.ok).toBe(true);
    const after = await fake.repo.findServiceVisitPricingByVisitId(visitId);
    expect(after?.customDiscountAmount).toBe(0);
  });
});

describe("resendFinalTotalLinkAction", () => {
  it("rejects when unauthorized", async () => {
    mockUnauthorized();
    await expect(resendFinalTotalLinkAction(null, formData({ serviceVisitId: "v" }))).rejects.toThrow(AdminUnauthorizedError);
  });

  it("refuses to resend before anything has ever been sent", async () => {
    mockRole("operations");
    const visitId = await seedWorkFinishedVisit();
    const result = await resendFinalTotalLinkAction(null, formData({ serviceVisitId: visitId }));
    expect(result.ok).toBe(false);
  });

  it("resends using a fresh versionKey, creating a second distinct notification row without touching pricing", async () => {
    mockRole("operations");
    const visitId = await seedWorkFinishedVisit();
    await finalizeAndSendAction(null, formData({ serviceVisitId: visitId }));
    const pricingBefore = await fake.repo.findServiceVisitPricingByVisitId(visitId);

    const result = await resendFinalTotalLinkAction(null, formData({ serviceVisitId: visitId }));

    expect(result.ok).toBe(true);
    const notices = [...fake.state.notifications.values()].filter((n) => n.serviceVisitId === visitId && n.notificationType === "final_total_ready");
    expect(notices.length).toBe(2);
    const pricingAfter = await fake.repo.findServiceVisitPricingByVisitId(visitId);
    expect(pricingAfter).toEqual(pricingBefore);
  });
});
