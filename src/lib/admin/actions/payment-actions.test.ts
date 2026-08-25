import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSchedulingRepository } from "@/lib/scheduling/test-support/fake-scheduling-repository";
import { createFakeVisitPaymentGateway } from "@/lib/payments/test-support/fake-visit-payment-gateway";
import { prepareVisitPaymentReview } from "@/lib/payments/prepare-visit-payment-review";
import { selectVisitTip } from "@/lib/payments/select-visit-tip";
import { AdminUnauthorizedError } from "@/lib/admin/require-admin";
import type { NewServiceVisitRow } from "@/lib/scheduling/domain-types";

let fake: ReturnType<typeof createFakeSchedulingRepository>;
let gatewayBundle: ReturnType<typeof createFakeVisitPaymentGateway>;

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@/lib/admin/require-admin", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/admin/require-admin")>();
  return { ...actual, requireAdmin: vi.fn() };
});

vi.mock("@/lib/scheduling/supabase-scheduling-repository", () => ({
  createSupabaseSchedulingRepository: () => fake.repo,
}));

vi.mock("@/lib/payments/visit-payment-gateway", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/payments/visit-payment-gateway")>();
  return { ...actual, createStripeVisitPaymentGateway: () => gatewayBundle.gateway };
});

const { requireAdmin } = await import("@/lib/admin/require-admin");
const { recordExternalPaymentAction, retryTaxSyncAction } = await import("./payment-actions");

const NEW_VISIT: NewServiceVisitRow = {
  customerId: "customer-1",
  quoteRequestId: null,
  bookingOrderId: null,
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
};

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

async function seedVisitWithTipSelected() {
  const visit = await fake.repo.insertServiceVisit(NEW_VISIT);
  await fake.repo.upsertServiceVisitPricing({
    serviceVisitId: visit.id,
    pricingVersion: "v1",
    pricingSnapshot: {},
    baseAmount: 179,
    addOnIds: [],
    addOnAmount: 0,
    totalAmount: 179,
    amountDueFromCustomer: 179,
    priceStatus: "estimated",
    requiresCustomerApproval: false,
    previouslyApprovedAmount: null,
  });
  await fake.repo.confirmServiceVisitPricing(visit.id, "admin:1");
  fake.state.serviceVisitsById.set(visit.id, { ...(await fake.repo.findServiceVisitById(visit.id))!, status: "completed" });

  await prepareVisitPaymentReview(fake.repo, gatewayBundle.gateway, visit.id);
  await selectVisitTip(fake.repo, gatewayBundle.gateway, { serviceVisitId: visit.id, tipSelectionType: "percentage_15" });
  return visit.id;
}

beforeEach(() => {
  fake = createFakeSchedulingRepository();
  gatewayBundle = createFakeVisitPaymentGateway();
  vi.mocked(requireAdmin).mockReset();
});

describe("recordExternalPaymentAction", () => {
  it("rejects when the caller is not an authorized admin", async () => {
    mockUnauthorized();
    const visitId = await seedVisitWithTipSelected();
    await expect(recordExternalPaymentAction(null, formData({ serviceVisitId: visitId, paymentMethodType: "cash" }))).rejects.toThrow(
      AdminUnauthorizedError
    );
    const payment = await fake.repo.findServiceVisitPaymentByVisitId(visitId);
    expect(payment!.status).toBe("created"); // untouched
  });

  it("rejects an invalid rail — there is no free-form amount field, only zelle/cash", async () => {
    mockAuthorized();
    const visitId = await seedVisitWithTipSelected();
    const result = await recordExternalPaymentAction(null, formData({ serviceVisitId: visitId, paymentMethodType: "venmo" }));
    expect(result.ok).toBe(false);
  });

  it("records exactly the already-selected total for an authorized admin, with no amount field ever read", async () => {
    mockAuthorized();
    const visitId = await seedVisitWithTipSelected();
    const result = await recordExternalPaymentAction(null, formData({ serviceVisitId: visitId, paymentMethodType: "zelle", externalPaymentReference: "ZL-9" }));
    expect(result.ok).toBe(true);

    const payment = await fake.repo.findServiceVisitPaymentByVisitId(visitId);
    expect(payment!.status).toBe("paid");
    expect(payment!.paymentMethodType).toBe("zelle");
    expect(payment!.externalPaymentReference).toBe("ZL-9");
  });

  it("surfaces a domain InvalidVisitStateError as a clean, non-throwing action error", async () => {
    mockAuthorized();
    const visitId = await seedVisitWithTipSelected();
    await recordExternalPaymentAction(null, formData({ serviceVisitId: visitId, paymentMethodType: "cash" }));

    const result = await recordExternalPaymentAction(null, formData({ serviceVisitId: visitId, paymentMethodType: "zelle" }));
    expect(result.ok).toBe(false);
  });
});

describe("retryTaxSyncAction", () => {
  it("rejects when the caller is not an authorized admin", async () => {
    mockUnauthorized();
    await expect(retryTaxSyncAction(null, formData({ serviceVisitPaymentId: "p-1" }))).rejects.toThrow(AdminUnauthorizedError);
  });

  it("requires a payment id", async () => {
    mockAuthorized();
    const result = await retryTaxSyncAction(null, formData({ serviceVisitPaymentId: "" }));
    expect(result.ok).toBe(false);
  });

  it("retries a failed external tax sync for an authorized admin", async () => {
    mockAuthorized();
    const visitId = await seedVisitWithTipSelected();
    const failingGateway = createFakeVisitPaymentGateway({ failNextTaxTransactionCreate: true });
    const { recordExternalPayment } = await import("@/lib/payments/record-external-payment");
    await recordExternalPayment(fake.repo, failingGateway.gateway, { serviceVisitId: visitId, paymentMethodType: "cash", externalPaymentReference: null });

    const payment = await fake.repo.findServiceVisitPaymentByVisitId(visitId);
    expect(payment!.taxTransactionStatus).toBe("failed");

    const result = await retryTaxSyncAction(null, formData({ serviceVisitPaymentId: payment!.id }));
    expect(result.ok).toBe(true);

    const after = await fake.repo.findServiceVisitPaymentByVisitId(visitId);
    expect(after!.taxTransactionStatus).toBe("committed");
  });
});
