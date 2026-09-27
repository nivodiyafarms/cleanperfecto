import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSchedulingRepository } from "@/lib/scheduling/test-support/fake-scheduling-repository";
import { createFakeBookingRepository } from "@/lib/booking/test-support/fake-booking-repository";
import { createFakeVisitPaymentGateway } from "@/lib/payments/test-support/fake-visit-payment-gateway";
import { CustomerOwnershipError } from "@/lib/customer-portal/ownership";
import type { NewServiceVisitRow } from "@/lib/scheduling/domain-types";
import type { CustomerSession } from "@/lib/customer-portal/require-customer";

let fakeScheduling: ReturnType<typeof createFakeSchedulingRepository>;
let fakeBooking: ReturnType<typeof createFakeBookingRepository>;
let fakeGatewayBundle: ReturnType<typeof createFakeVisitPaymentGateway>;

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@/lib/customer-portal/require-customer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/customer-portal/require-customer")>();
  return { ...actual, requireCustomer: vi.fn() };
});

vi.mock("@/lib/scheduling/supabase-scheduling-repository", () => ({
  createSupabaseSchedulingRepository: () => fakeScheduling.repo,
}));

vi.mock("@/lib/booking/supabase-booking-repository", () => ({
  createSupabaseBookingRepository: () => fakeBooking.repo,
}));

vi.mock("@/lib/payments/visit-payment-gateway", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/payments/visit-payment-gateway")>();
  return { ...actual, createStripeVisitPaymentGateway: () => fakeGatewayBundle.gateway };
});

vi.mock("@/lib/booking/stripe/client", () => ({ getStripeClient: () => ({}) }));

vi.mock("@/lib/payments/create-payment-method-setup", () => ({
  createPaymentMethodSetupCheckoutSession: vi.fn(async () => "https://checkout.stripe.com/test_setup_session"),
}));

const { requireCustomer } = await import("@/lib/customer-portal/require-customer");
const {
  getVisitPaymentReviewAction,
  selectVisitTipAction,
  confirmVisitPaymentAction,
  createPaymentMethodSetupUrlAction,
  getVisitPaymentStatusAction,
  getVisitPricingStateAction,
  previewFinalTotalTipAction,
} = await import("./payment-actions");

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

function mockSession(customerId = "customer-1") {
  vi.mocked(requireCustomer).mockResolvedValue({ customerAccountId: "acct-1", customerId, supabaseUserId: "user-1" } as CustomerSession);
}

async function seedCompletedConfirmedVisit(customerId = "customer-1") {
  const visit = await fakeScheduling.repo.insertServiceVisit({ ...NEW_VISIT, customerId });
  await fakeScheduling.repo.upsertServiceVisitPricing({
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
  await fakeScheduling.repo.confirmServiceVisitPricing(visit.id, "admin:1");
  fakeScheduling.state.serviceVisitsById.set(visit.id, {
    ...(await fakeScheduling.repo.findServiceVisitById(visit.id))!,
    status: "completed",
  });
  return visit.id;
}

/** Mirrors the real Finalize & Send outcome for a visit with a custom charge and discount/credit — base $138.72 + charge $30 - discount $10 = $158.72. */
async function seedCompletedConfirmedVisitWithAdjustments(customerId = "customer-1") {
  const visit = await fakeScheduling.repo.insertServiceVisit({ ...NEW_VISIT, customerId });
  await fakeScheduling.repo.upsertServiceVisitPricing({
    serviceVisitId: visit.id,
    pricingVersion: "v1",
    pricingSnapshot: {},
    baseAmount: 138.72,
    addOnIds: [],
    addOnAmount: 0,
    customAdjustments: [
      {
        id: "adj-1",
        type: "custom_charge",
        description: "Extra wall cleaning",
        amount: 30,
        addedByAdminUserId: "admin:1",
        addedByRole: "operations",
        addedAt: new Date(),
      },
      {
        id: "adj-2",
        type: "custom_discount",
        description: "Courtesy credit",
        amount: 10,
        addedByAdminUserId: "owner:1",
        addedByRole: "owner_admin",
        addedAt: new Date(),
      },
    ],
    customChargeAmount: 30,
    customDiscountAmount: 10,
    totalAmount: 158.72,
    amountDueFromCustomer: 158.72,
    priceStatus: "estimated",
    requiresCustomerApproval: false,
    previouslyApprovedAmount: null,
  });
  await fakeScheduling.repo.confirmServiceVisitPricing(visit.id, "admin:1");
  fakeScheduling.state.serviceVisitsById.set(visit.id, {
    ...(await fakeScheduling.repo.findServiceVisitById(visit.id))!,
    status: "completed",
  });
  return visit.id;
}

beforeEach(() => {
  fakeScheduling = createFakeSchedulingRepository();
  fakeBooking = createFakeBookingRepository({
    customers: {
      "customer-1": {
        id: "customer-1",
        name: "Jane",
        email: "jane@example.com",
        phone: null,
        stripeCustomerId: "cus_1",
        stripeDefaultPaymentMethodId: "pm_1",
        stripePaymentMethodBrand: "visa",
        stripePaymentMethodLast4: "4242",
      },
    },
  });
  fakeGatewayBundle = createFakeVisitPaymentGateway();
  vi.mocked(requireCustomer).mockReset();
});

describe("getVisitPaymentReviewAction", () => {
  it("rejects a visit that does not belong to the authenticated customer", async () => {
    mockSession("customer-1");
    const visitId = await seedCompletedConfirmedVisit("customer-2");
    await expect(getVisitPaymentReviewAction(visitId)).rejects.toThrow(CustomerOwnershipError);
  });

  it("returns a review for the owning customer's visit", async () => {
    mockSession("customer-1");
    const visitId = await seedCompletedConfirmedVisit("customer-1");
    const result = await getVisitPaymentReviewAction(visitId);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.approvedAmount).toBe(179);
  });

  it("exposes the original booking price and every adjustment line item — customer sees original vs final price and all line items", async () => {
    mockSession("customer-1");
    const visitId = await seedCompletedConfirmedVisitWithAdjustments("customer-1");
    const result = await getVisitPaymentReviewAction(visitId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.baseAmount).toBe(138.72);
    expect(result.data.approvedAmount).toBe(158.72);
    expect(result.data.lineItems).toEqual([
      { description: "Extra wall cleaning", amount: 30 },
      { description: "Courtesy credit", amount: -10 },
    ]);
  });
});

describe("selectVisitTipAction", () => {
  it("rejects a visit that does not belong to the authenticated customer", async () => {
    mockSession("customer-1");
    const visitId = await seedCompletedConfirmedVisit("customer-2");
    await expect(selectVisitTipAction(visitId, "percentage_15")).rejects.toThrow(CustomerOwnershipError);
  });

  it("selects a tip for the owning customer's visit after review", async () => {
    mockSession("customer-1");
    const visitId = await seedCompletedConfirmedVisit("customer-1");
    await getVisitPaymentReviewAction(visitId);
    const result = await selectVisitTipAction(visitId, "percentage_20");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.tipAmount).toBeCloseTo(179 * 0.2, 2);
  });
});

describe("confirmVisitPaymentAction", () => {
  it("rejects a visit that does not belong to the authenticated customer", async () => {
    mockSession("customer-1");
    const visitId = await seedCompletedConfirmedVisit("customer-2");
    await expect(confirmVisitPaymentAction(visitId)).rejects.toThrow(CustomerOwnershipError);
  });

  it("returns a ready PaymentIntent outcome for the owning customer with a saved card", async () => {
    mockSession("customer-1");
    const visitId = await seedCompletedConfirmedVisit("customer-1");
    await getVisitPaymentReviewAction(visitId);
    await selectVisitTipAction(visitId, "percentage_15");

    const result = await confirmVisitPaymentAction(visitId);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.outcome).toBe("ready");
  });

  it("SAVED PAYMENT METHOD != AUTHORIZATION TO CHARGE: no PaymentIntent exists after review + tip selection alone — only confirmVisitPaymentAction (the customer's explicit Pay click) creates one", async () => {
    mockSession("customer-1");
    const visitId = await seedCompletedConfirmedVisit("customer-1");
    await getVisitPaymentReviewAction(visitId);
    await selectVisitTipAction(visitId, "percentage_15");

    const beforePay = await fakeScheduling.repo.findServiceVisitPaymentByVisitId(visitId);
    expect(beforePay?.stripePaymentIntentId ?? null).toBeNull();
    expect(fakeGatewayBundle.state.createPaymentIntentCallCount).toBe(0);

    await confirmVisitPaymentAction(visitId);

    expect(fakeGatewayBundle.state.createPaymentIntentCallCount).toBe(1);
    const afterPay = await fakeScheduling.repo.findServiceVisitPaymentByVisitId(visitId);
    expect(afterPay?.stripePaymentIntentId).not.toBeNull();
  });
});

describe("createPaymentMethodSetupUrlAction", () => {
  it("rejects a visit that does not belong to the authenticated customer", async () => {
    mockSession("customer-1");
    const visitId = await seedCompletedConfirmedVisit("customer-2");
    await expect(createPaymentMethodSetupUrlAction(visitId)).rejects.toThrow(CustomerOwnershipError);
  });

  it("returns a Stripe-hosted setup url for the owning customer", async () => {
    mockSession("customer-1");
    const visitId = await seedCompletedConfirmedVisit("customer-1");
    const result = await createPaymentMethodSetupUrlAction(visitId);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.url).toBe("https://checkout.stripe.com/test_setup_session");
  });
});

describe("getVisitPaymentStatusAction", () => {
  it("rejects a visit that does not belong to the authenticated customer", async () => {
    mockSession("customer-1");
    const visitId = await seedCompletedConfirmedVisit("customer-2");
    await expect(getVisitPaymentStatusAction(visitId)).rejects.toThrow(CustomerOwnershipError);
  });

  it("returns null when no payment row exists yet", async () => {
    mockSession("customer-1");
    const visitId = await seedCompletedConfirmedVisit("customer-1");
    const result = await getVisitPaymentStatusAction(visitId);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toBeNull();
  });

  it("never exposes payment rail, card brand/last4, external reference, or any Stripe id — customer-safe DTO only", async () => {
    mockSession("customer-1");
    const visitId = await seedCompletedConfirmedVisit("customer-1");
    await getVisitPaymentReviewAction(visitId);
    await selectVisitTipAction(visitId, "percentage_15");
    await confirmVisitPaymentAction(visitId);

    const result = await getVisitPaymentStatusAction(visitId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).not.toBeNull();
    const keys = Object.keys(result.data as object);
    expect(keys).not.toContain("paymentMethodType");
    expect(keys).not.toContain("cardBrand");
    expect(keys).not.toContain("cardLast4");
    expect(keys).not.toContain("externalPaymentReference");
    expect(keys).not.toContain("stripePaymentIntentId");
    expect(keys).not.toContain("stripeTaxCalculationId");
    expect(keys).not.toContain("stripeTaxTransactionId");
    expect(keys).toEqual(
      expect.arrayContaining(["status", "approvedAmount", "tipAmount", "taxAmount", "totalAmount", "paidAt", "refundedAmount", "needsClientConfirmation"])
    );
  });
});

async function seedWorkFinishedNotYetConfirmed(customerId = "customer-1") {
  const visit = await fakeScheduling.repo.insertServiceVisit({ ...NEW_VISIT, customerId });
  await fakeScheduling.repo.upsertServiceVisitPricing({
    serviceVisitId: visit.id,
    pricingVersion: "v1",
    pricingSnapshot: {},
    baseAmount: 200,
    addOnIds: ["inside_oven"],
    addOnAmount: 30,
    totalAmount: 230,
    amountDueFromCustomer: 230,
    priceStatus: "estimated",
    requiresCustomerApproval: false,
    previouslyApprovedAmount: null,
  });
  fakeScheduling.state.serviceVisitsById.set(visit.id, {
    ...(await fakeScheduling.repo.findServiceVisitById(visit.id))!,
    status: "work_finished",
    workFinishedAt: new Date(),
  });
  return visit.id;
}

describe("getVisitPricingStateAction", () => {
  it("rejects a visit that does not belong to the authenticated customer", async () => {
    mockSession("customer-1");
    const visitId = await seedWorkFinishedNotYetConfirmed("customer-2");
    await expect(getVisitPricingStateAction(visitId)).rejects.toThrow(CustomerOwnershipError);
  });

  it("reports readyForPayment=false for a work-finished visit whose pricing hasn't been confirmed/completed yet (Finalize & Send hasn't run)", async () => {
    mockSession("customer-1");
    const visitId = await seedWorkFinishedNotYetConfirmed("customer-1");
    const result = await getVisitPricingStateAction(visitId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.readyForPayment).toBe(false);
    expect(result.data.totalAmount).toBe(230);
  });

  it("reports readyForPayment=true once Finalize & Send has confirmed pricing and completed the visit", async () => {
    mockSession("customer-1");
    const visitId = await seedCompletedConfirmedVisit("customer-1");
    const result = await getVisitPricingStateAction(visitId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.readyForPayment).toBe(true);
    expect(result.data.totalAmount).toBe(179);
  });
});

describe("previewFinalTotalTipAction", () => {
  it("rejects a visit that does not belong to the authenticated customer", async () => {
    mockSession("customer-1");
    const visitId = await seedWorkFinishedNotYetConfirmed("customer-2");
    await expect(previewFinalTotalTipAction(visitId, "percentage_15")).rejects.toThrow(CustomerOwnershipError);
  });

  it("previews tax/tip without persisting anything — no service_visit_payments row is created", async () => {
    mockSession("customer-1");
    const visitId = await seedWorkFinishedNotYetConfirmed("customer-1");

    const result = await previewFinalTotalTipAction(visitId, "percentage_20");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.tipAmount).toBeCloseTo(230 * 0.2, 2);
    }
    const payment = await fakeScheduling.repo.findServiceVisitPaymentByVisitId(visitId);
    expect(payment).toBeNull();
    const pricing = await fakeScheduling.repo.findServiceVisitPricingByVisitId(visitId);
    expect(pricing?.priceStatus).toBe("estimated"); // untouched by the preview
  });

  it("supports a custom $0 tip preview", async () => {
    mockSession("customer-1");
    const visitId = await seedWorkFinishedNotYetConfirmed("customer-1");

    const result = await previewFinalTotalTipAction(visitId, "custom", 0);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.tipAmount).toBe(0);
  });
});
