import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CalculationInput } from "@/lib/pricing/types";
import { createFakeSchedulingRepository } from "@/lib/scheduling/test-support/fake-scheduling-repository";
import { AdminUnauthorizedError } from "@/lib/admin/require-admin";

const BASE_INPUT: CalculationInput = {
  propertyKind: "home",
  cleaningType: "standard",
  condition: "light",
  sizeTier: "2br_2ba",
  zip: "75056",
  frequency: "weekly",
  isPrepaidPackage: true,
  visitCount: 6,
  addOnIds: [],
  firstCleaningEligible: false,
  asOf: new Date("2026-08-22T00:00:00Z"),
};

let fake: ReturnType<typeof createFakeSchedulingRepository>;

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@/lib/admin/require-admin", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/admin/require-admin")>();
  return { ...actual, requireAdmin: vi.fn() };
});

vi.mock("@/lib/scheduling/supabase-scheduling-repository", () => ({
  createSupabaseSchedulingRepository: () => fake.repo,
}));

vi.mock("@/lib/admin/queries/visit-scope", () => ({
  resolvePackageSchedulingContext: async () => ({
    customerId: "customer-1",
    cleaningType: "standard",
    serviceAddressLine1: null,
    serviceAddressLine2: null,
    serviceCity: null,
    serviceState: null,
    serviceAddressIdentity: null,
    calculationInput: BASE_INPUT,
  }),
}));

const { requireAdmin } = await import("@/lib/admin/require-admin");
const { createPackageAmendmentAction, recordAmendmentApprovalAction, recordAmendmentPaymentAction, applyPackageAmendmentAction } =
  await import("./package-actions");

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

function seedPackage(remainingVisitCount = 4) {
  fake = createFakeSchedulingRepository({
    prepaidPackages: [
      {
        id: "pkg-1",
        customerId: "customer-1",
        bookingOrderId: "booking-1",
        frequency: "weekly",
        purchasedVisitCount: 6,
        remainingVisitCount,
        effectivePricePerVisit: 100,
        status: "active",
      },
    ],
  });
}

beforeEach(() => {
  seedPackage();
  vi.mocked(requireAdmin).mockReset();
});

describe("createPackageAmendmentAction", () => {
  it("rejects when unauthorized", async () => {
    mockUnauthorized();
    await expect(
      createPackageAmendmentAction(null, formData({ prepaidPackageId: "pkg-1", newCadence: "weekly", effectiveFromVisitNumber: "3" }))
    ).rejects.toThrow(AdminUnauthorizedError);
  });

  it("prepares an amendment starting in pending_customer_approval — never pre-approved", async () => {
    mockAuthorized();
    const result = await createPackageAmendmentAction(
      null,
      formData({ prepaidPackageId: "pkg-1", newCadence: "weekly", effectiveFromVisitNumber: "3" })
    );
    expect(result.ok).toBe(true);
    const amendment = [...fake.state.packageAmendmentsById.values()][0];
    expect(amendment.approvalState).toBe("pending_customer_approval");
  });
});

describe("applyPackageAmendmentAction — no silent approval, no bypass", () => {
  it("refuses to apply an amendment that hasn't been approved yet", async () => {
    mockAuthorized();
    await createPackageAmendmentAction(null, formData({ prepaidPackageId: "pkg-1", newCadence: "weekly", effectiveFromVisitNumber: "3" }));
    const amendment = [...fake.state.packageAmendmentsById.values()][0];

    const result = await applyPackageAmendmentAction(
      null,
      formData({ packageAmendmentId: amendment.id, prepaidPackageId: "pkg-1", newFirstDate: "2026-09-20", newFirstStartTime: "10:00" })
    );
    expect(result.ok).toBe(false);
  });

  it("refuses to apply a price-increase amendment that's approved but not yet paid", async () => {
    mockAuthorized();
    await createPackageAmendmentAction(null, formData({ prepaidPackageId: "pkg-1", newCadence: "weekly", effectiveFromVisitNumber: "3" }));
    const amendment = [...fake.state.packageAmendmentsById.values()][0];
    expect(amendment.valueDifference).toBeGreaterThan(0); // weekly is pricier than the $100 placeholder baseline

    await recordAmendmentApprovalAction(null, formData({ packageAmendmentId: amendment.id, prepaidPackageId: "pkg-1", decision: "approved" }));

    const result = await applyPackageAmendmentAction(
      null,
      formData({ packageAmendmentId: amendment.id, prepaidPackageId: "pkg-1", newFirstDate: "2026-09-20", newFirstStartTime: "10:00" })
    );
    expect(result.ok).toBe(false);
  });

  it("applies a price-increase amendment once both approval and payment are explicitly recorded", async () => {
    mockAuthorized();
    await createPackageAmendmentAction(null, formData({ prepaidPackageId: "pkg-1", newCadence: "weekly", effectiveFromVisitNumber: "3" }));
    const amendment = [...fake.state.packageAmendmentsById.values()][0];

    await recordAmendmentApprovalAction(null, formData({ packageAmendmentId: amendment.id, prepaidPackageId: "pkg-1", decision: "approved" }));
    await recordAmendmentPaymentAction(null, formData({ packageAmendmentId: amendment.id, prepaidPackageId: "pkg-1" }));

    const result = await applyPackageAmendmentAction(
      null,
      formData({ packageAmendmentId: amendment.id, prepaidPackageId: "pkg-1", newFirstDate: "2026-09-20", newFirstStartTime: "10:00" })
    );
    expect(result.ok).toBe(true);
  });
});

describe("recordAmendmentApprovalAction", () => {
  it("rejects when unauthorized", async () => {
    mockUnauthorized();
    await expect(
      recordAmendmentApprovalAction(null, formData({ packageAmendmentId: "a", prepaidPackageId: "pkg-1", decision: "approved" }))
    ).rejects.toThrow(AdminUnauthorizedError);
  });
});
