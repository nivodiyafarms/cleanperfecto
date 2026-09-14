import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSchedulingRepository } from "@/lib/scheduling/test-support/fake-scheduling-repository";
import { createFakeVisitPaymentGateway } from "@/lib/payments/test-support/fake-visit-payment-gateway";
import { prepareVisitPaymentReview } from "@/lib/payments/prepare-visit-payment-review";
import { selectVisitTip } from "@/lib/payments/select-visit-tip";
import { AdminUnauthorizedError } from "@/lib/admin/require-admin";
import type { NewServiceVisitRow } from "@/lib/scheduling/domain-types";

let fake: ReturnType<typeof createFakeSchedulingRepository>;
let gatewayBundle: ReturnType<typeof createFakeVisitPaymentGateway>;
let bookingFake: ReturnType<typeof createFakeBookingRepository>;

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

vi.mock("@/lib/booking/supabase-booking-repository", () => ({
  createSupabaseBookingRepository: () => bookingFake.repo,
}));

const { requireAdmin } = await import("@/lib/admin/require-admin");
const { recordExternalPaymentAction, retryTaxSyncAction, refundPaymentAction, refundPrepaidPackageAction, retryTaxReversalAction } = await import("./payment-actions");
const { createVisitPaymentIntent } = await import("@/lib/payments/create-visit-payment-intent");
const { reconcileVisitPayment } = await import("@/lib/payments/reconcile-visit-payment");
const { createFakeBookingRepository } = await import("@/lib/booking/test-support/fake-booking-repository");
const { AdminForbiddenError } = await import("@/lib/admin/rbac/capabilities");

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
  bookingFake = createFakeBookingRepository();
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

  it("Phase 2: a successful external-payment recording is traceable to its actor in the financial audit log", async () => {
    mockAuthorized();
    const visitId = await seedVisitWithTipSelected();
    const result = await recordExternalPaymentAction(null, formData({ serviceVisitId: visitId, paymentMethodType: "cash", externalPaymentReference: "note" }));
    expect(result.ok).toBe(true);

    expect(fake.state.financialAuditLog).toHaveLength(1);
    const [entry] = fake.state.financialAuditLog;
    expect(entry.actorAdminUserId).toBe("admin-1");
    expect(entry.actorRole).toBe("admin");
    expect(entry.actionType).toBe("external_payment_recorded");
    expect(entry.targetEntityType).toBe("service_visit_payment");
    expect(entry.serviceVisitId).toBe(visitId);
    expect(entry.metadata).toMatchObject({ paymentMethodType: "cash" });
  });

  it("does not write a financial audit row when the recording fails before any financial mutation", async () => {
    mockAuthorized();
    const visitId = await seedVisitWithTipSelected();
    // First call settles the payment; a second call for the same
    // already-settled row is rejected before any further mutation.
    await recordExternalPaymentAction(null, formData({ serviceVisitId: visitId, paymentMethodType: "cash" }));
    fake.state.financialAuditLog.length = 0;

    const result = await recordExternalPaymentAction(null, formData({ serviceVisitId: visitId, paymentMethodType: "zelle" }));
    expect(result.ok).toBe(false);
    expect(fake.state.financialAuditLog).toHaveLength(0);
  });

  it("Phase 2 money-path integrity: an audit-write failure leaves the payment unsettled, not silently paid-without-audit", async () => {
    mockAuthorized();
    const visitId = await seedVisitWithTipSelected();
    fake.state.financialAuditControl.simulateFailure = true;

    // The action's generic catch rethrows anything that isn't
    // InvalidVisitStateError, so this surfaces as a thrown error here —
    // proving the failure is never silently swallowed into a false "ok".
    await expect(recordExternalPaymentAction(null, formData({ serviceVisitId: visitId, paymentMethodType: "cash" }))).rejects.toThrow();

    const payment = await fake.repo.findServiceVisitPaymentByVisitId(visitId);
    expect(payment!.status).toBe("created");
    expect(fake.state.financialAuditLog).toHaveLength(0);
  });

  it("surfaces a domain InvalidVisitStateError as a clean, non-throwing action error", async () => {
    mockAuthorized();
    const visitId = await seedVisitWithTipSelected();
    await recordExternalPaymentAction(null, formData({ serviceVisitId: visitId, paymentMethodType: "cash" }));

    const result = await recordExternalPaymentAction(null, formData({ serviceVisitId: visitId, paymentMethodType: "zelle" }));
    expect(result.ok).toBe(false);
  });

  it("Phase 2 RBAC: an operations-role admin CAN record a genuine external receipt through the frozen amount flow", async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ adminUserId: "ops-1", supabaseUserId: "user-ops", role: "operations" });
    const visitId = await seedVisitWithTipSelected();
    const result = await recordExternalPaymentAction(null, formData({ serviceVisitId: visitId, paymentMethodType: "cash" }));
    expect(result.ok).toBe(true);

    const payment = await fake.repo.findServiceVisitPaymentByVisitId(visitId);
    expect(payment!.status).toBe("paid");
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
    await recordExternalPayment(fake.repo, failingGateway.gateway, {
      serviceVisitId: visitId,
      paymentMethodType: "cash",
      externalPaymentReference: null,
      actorAdminUserId: "admin-1",
      actorRole: "admin",
    });

    const payment = await fake.repo.findServiceVisitPaymentByVisitId(visitId);
    expect(payment!.taxTransactionStatus).toBe("failed");

    const result = await retryTaxSyncAction(null, formData({ serviceVisitPaymentId: payment!.id }));
    expect(result.ok).toBe(true);

    const after = await fake.repo.findServiceVisitPaymentByVisitId(visitId);
    expect(after!.taxTransactionStatus).toBe("committed");
  });
});

async function seedPaidVisitViaStripeCard() {
  const visitId = await seedVisitWithTipSelected();
  const { repo: bookingRepo } = createFakeBookingRepository({
    customers: { "customer-1": { id: "customer-1", name: "Jane", email: "jane@example.com", phone: null, stripeCustomerId: "cus_1", stripeDefaultPaymentMethodId: "pm_1", stripePaymentMethodBrand: "visa", stripePaymentMethodLast4: "4242" } },
  });
  const outcome = await createVisitPaymentIntent(fake.repo, bookingRepo, gatewayBundle.gateway, { serviceVisitId: visitId, customerId: "customer-1" });
  if (outcome.outcome !== "ready") throw new Error("expected ready");
  const payment = (await fake.repo.findServiceVisitPaymentByVisitId(visitId))!;
  await reconcileVisitPayment(fake.repo, gatewayBundle.gateway, { stripePaymentIntentId: payment.stripePaymentIntentId!, status: "paid" });
  const paid = (await fake.repo.findServiceVisitPaymentByVisitId(visitId))!;
  return { visitId, payment: paid };
}

describe("refundPaymentAction", () => {
  it("rejects when the caller is not an authorized admin", async () => {
    mockUnauthorized();
    await expect(refundPaymentAction(null, formData({ serviceVisitId: "v-1", refundAmount: "50", reason: "x" }))).rejects.toThrow(AdminUnauthorizedError);
  });

  it("Phase E RBAC: owner-only — an operations-role admin is denied", async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ adminUserId: "ops-1", supabaseUserId: "user-ops", role: "operations" });
    const { visitId, payment } = await seedPaidVisitViaStripeCard();

    await expect(refundPaymentAction(null, formData({ serviceVisitId: visitId, refundAmount: String(payment.totalAmount), reason: "attempted by operations" }))).rejects.toThrow(
      AdminForbiddenError
    );

    const after = await fake.repo.findServiceVisitPaymentByVisitId(visitId);
    expect(after!.status).toBe("paid"); // untouched
  });

  it("an owner_admin CAN issue a full refund", async () => {
    mockAuthorized();
    const { visitId, payment } = await seedPaidVisitViaStripeCard();

    const result = await refundPaymentAction(null, formData({ serviceVisitId: visitId, refundAmount: String(payment.totalAmount), reason: "customer requested" }));
    expect(result.ok).toBe(true);

    const after = await fake.repo.findServiceVisitPaymentByVisitId(visitId);
    expect(after!.status).toBe("refunded");
  });

  it("requires a positive refund amount", async () => {
    mockAuthorized();
    const { visitId } = await seedPaidVisitViaStripeCard();
    const result = await refundPaymentAction(null, formData({ serviceVisitId: visitId, refundAmount: "0", reason: "x" }));
    expect(result.ok).toBe(false);
  });

  it("requires a reason", async () => {
    mockAuthorized();
    const { visitId, payment } = await seedPaidVisitViaStripeCard();
    const result = await refundPaymentAction(null, formData({ serviceVisitId: visitId, refundAmount: String(payment.totalAmount), reason: "" }));
    expect(result.ok).toBe(false);
  });

  it("surfaces an over-refund attempt as a clean action error, not a thrown exception", async () => {
    mockAuthorized();
    const { visitId, payment } = await seedPaidVisitViaStripeCard();
    const result = await refundPaymentAction(null, formData({ serviceVisitId: visitId, refundAmount: String(payment.totalAmount! + 100), reason: "too much" }));
    expect(result.ok).toBe(false);
  });

  it("financial_audit_log records the refund with owner attribution", async () => {
    mockAuthorized();
    const { visitId, payment } = await seedPaidVisitViaStripeCard();
    await refundPaymentAction(null, formData({ serviceVisitId: visitId, refundAmount: String(payment.totalAmount), reason: "audited refund" }));

    expect(fake.state.financialAuditLog).toHaveLength(1);
    const [entry] = fake.state.financialAuditLog;
    expect(entry.actionType).toBe("refund_issued");
    expect(entry.actorAdminUserId).toBe("admin-1");
    expect(entry.reason).toBe("audited refund");
  });
});

async function seedActivePrepaidPackage(remainingVisitCount = 4) {
  const bookingOrderId = "booking-pkg-1";
  fake = createFakeSchedulingRepository({
    prepaidPackages: [
      {
        id: "pkg-1",
        customerId: "customer-1",
        bookingOrderId,
        frequency: "weekly",
        purchasedVisitCount: 6,
        remainingVisitCount,
        packageTotalPaid: 900,
        effectivePricePerVisit: 150,
        status: "active",
        purchasedAt: new Date("2026-08-01T00:00:00Z"),
      },
    ],
  });
  const attempt = await bookingFake.repo.insertPaymentAttempt({
    bookingOrderId,
    mode: "payment",
    stripeCheckoutSessionId: "cs_pkg_1",
    stripeCustomerId: "cus_1",
    amount: 900,
    paymentMethodType: null,
    packageSubtotalBeforeAchIncentive: null,
    achSavingsAmount: null,
  });
  await bookingFake.repo.updatePaymentAttemptBySessionId(attempt.stripeCheckoutSessionId, { status: "completed", stripePaymentIntentId: "pi_pkg_1" });
}

describe("refundPrepaidPackageAction", () => {
  it("rejects when the caller is not an authorized admin", async () => {
    mockUnauthorized();
    await expect(refundPrepaidPackageAction(null, formData({ prepaidPackageId: "pkg-1", reason: "x" }))).rejects.toThrow(AdminUnauthorizedError);
  });

  it("Phase G RBAC: owner-only — an operations-role admin is denied and the package is left untouched", async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ adminUserId: "ops-1", supabaseUserId: "user-ops", role: "operations" });
    await seedActivePrepaidPackage();

    await expect(refundPrepaidPackageAction(null, formData({ prepaidPackageId: "pkg-1", reason: "attempted by operations" }))).rejects.toThrow(AdminForbiddenError);

    const after = await fake.repo.findPrepaidPackageById("pkg-1");
    expect(after!.status).toBe("active");
  });

  it("an owner_admin CAN cancel a package and receive the computed refund amount, never an admin-entered one", async () => {
    mockAuthorized();
    await seedActivePrepaidPackage(4);

    const result = await refundPrepaidPackageAction(null, formData({ prepaidPackageId: "pkg-1", reason: "customer requested", refundAmount: "999999" }));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.message).toContain("$600.00");

    const after = await fake.repo.findPrepaidPackageById("pkg-1");
    expect(after!.status).toBe("cancelled");
    expect(after!.refundedAmount).toBe(600);
  });

  it("requires a package id", async () => {
    mockAuthorized();
    const result = await refundPrepaidPackageAction(null, formData({ prepaidPackageId: "", reason: "x" }));
    expect(result.ok).toBe(false);
  });

  it("requires a reason", async () => {
    mockAuthorized();
    await seedActivePrepaidPackage();
    const result = await refundPrepaidPackageAction(null, formData({ prepaidPackageId: "pkg-1", reason: "" }));
    expect(result.ok).toBe(false);
  });

  it("surfaces cancelling an already-cancelled package as a clean action error, not a thrown exception", async () => {
    mockAuthorized();
    await seedActivePrepaidPackage();
    await refundPrepaidPackageAction(null, formData({ prepaidPackageId: "pkg-1", reason: "first cancel" }));

    const result = await refundPrepaidPackageAction(null, formData({ prepaidPackageId: "pkg-1", reason: "second cancel" }));
    expect(result.ok).toBe(false);
  });

  it("financial_audit_log records the package cancellation with owner attribution", async () => {
    mockAuthorized();
    await seedActivePrepaidPackage(4);
    await refundPrepaidPackageAction(null, formData({ prepaidPackageId: "pkg-1", reason: "audited package cancel" }));

    expect(fake.state.financialAuditLog).toHaveLength(1);
    const [entry] = fake.state.financialAuditLog;
    expect(entry.actionType).toBe("refund_issued");
    expect(entry.targetEntityType).toBe("prepaid_package");
    expect(entry.actorAdminUserId).toBe("admin-1");
    expect(entry.reason).toBe("audited package cancel");
  });
});

describe("retryTaxReversalAction", () => {
  it("rejects when the caller is not an authorized admin", async () => {
    mockUnauthorized();
    await expect(retryTaxReversalAction(null, formData({ reconciliationId: "r-1" }))).rejects.toThrow(AdminUnauthorizedError);
  });

  it("Phase F.1 RBAC: owner-only — an operations-role admin is denied", async () => {
    const reconciliation = await fake.repo.createTaxReversalReconciliation({
      targetEntityType: "service_visit_payment",
      targetEntityId: "payment-1",
      originalTransactionId: "txn_original",
      intendedAmount: 50,
      mode: "full",
    });
    vi.mocked(requireAdmin).mockResolvedValue({ adminUserId: "ops-1", supabaseUserId: "user-ops", role: "operations" });

    await expect(retryTaxReversalAction(null, formData({ reconciliationId: reconciliation.id }))).rejects.toThrow(AdminForbiddenError);

    const after = await fake.repo.findTaxReversalReconciliationById(reconciliation.id);
    expect(after!.status).toBe("pending"); // untouched
  });

  it("an owner_admin can retry a failed reconciliation to success", async () => {
    const reconciliation = await fake.repo.createTaxReversalReconciliation({
      targetEntityType: "service_visit_payment",
      targetEntityId: "payment-1",
      originalTransactionId: "txn_original",
      intendedAmount: 50,
      mode: "full",
    });
    await fake.repo.markTaxReversalReconciliationFailed(reconciliation.id, "prior transient failure");
    mockAuthorized();

    const result = await retryTaxReversalAction(null, formData({ reconciliationId: reconciliation.id }));
    expect(result.ok).toBe(true);

    const after = await fake.repo.findTaxReversalReconciliationById(reconciliation.id);
    expect(after!.status).toBe("succeeded");
  });

  it("requires a reconciliation id", async () => {
    mockAuthorized();
    const result = await retryTaxReversalAction(null, formData({ reconciliationId: "" }));
    expect(result.ok).toBe(false);
  });

  it("surfaces an unknown reconciliation id as a clean action error, not a thrown exception", async () => {
    mockAuthorized();
    const result = await retryTaxReversalAction(null, formData({ reconciliationId: "does-not-exist" }));
    expect(result.ok).toBe(false);
  });

  it("a still-failing retry returns a clean action error (not a thrown exception) describing the failure", async () => {
    const reconciliation = await fake.repo.createTaxReversalReconciliation({
      targetEntityType: "service_visit_payment",
      targetEntityId: "payment-1",
      originalTransactionId: "txn_original",
      intendedAmount: 50,
      mode: "full",
    });
    (gatewayBundle.gateway as unknown as { reverseTaxTransaction: () => Promise<never> }).reverseTaxTransaction = () => {
      throw new Error("still down");
    };
    mockAuthorized();

    const result = await retryTaxReversalAction(null, formData({ reconciliationId: reconciliation.id }));
    expect(result.ok).toBe(false);

    const after = await fake.repo.findTaxReversalReconciliationById(reconciliation.id);
    expect(after!.status).toBe("failed");
  });
});
