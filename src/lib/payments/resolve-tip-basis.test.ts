import { describe, expect, it } from "vitest";
import { createFakeSchedulingRepository } from "@/lib/scheduling/test-support/fake-scheduling-repository";
import type { PrepaidPackageRow, ServiceVisitPricingRow, ServiceVisitRow } from "@/lib/scheduling/domain-types";
import { InvalidVisitStateError } from "@/lib/scheduling/errors";
import { resolveTipBasisAmount } from "./resolve-tip-basis";

function baseVisit(overrides: Partial<ServiceVisitRow> = {}): ServiceVisitRow {
  return {
    id: "visit-1",
    customerId: "customer-1",
    quoteRequestId: null,
    bookingOrderId: null,
    prepaidPackageId: null,
    recurringScheduleId: null,
    visitNumber: null,
    cleaningType: "standard",
    frequency: "one_time",
    status: "completed",
    requestedStartAt: null,
    confirmedAt: null,
    confirmedStartAt: null,
    confirmedEndAt: null,
    estimatedLaborMinutes: null,
    estimatedServiceMinutes: null,
    recommendedCleanerCount: null,
    turnaroundBufferMinutes: null,
    timezone: "America/Chicago",
    workFinishedAt: null,
    completedAt: new Date(),
    cancelledAt: null,
    serviceAddressLine1: "123 Main St",
    serviceAddressLine2: null,
    serviceCity: "Frisco",
    serviceState: "TX",
    serviceAddressIdentity: "75056|123 MAIN ST|",
    reviewRequestSuppressed: false,
    ...overrides,
  };
}

function basePricing(overrides: Partial<ServiceVisitPricingRow> = {}): ServiceVisitPricingRow {
  return {
    id: "pricing-1",
    serviceVisitId: "visit-1",
    pricingVersion: "v1",
    pricingSnapshot: {},
    baseAmount: 0,
    addOnIds: [],
    addOnAmount: 0,
    totalAmount: 0,
    amountDueFromCustomer: 0,
    priceStatus: "confirmed",
    requiresCustomerApproval: false,
    previouslyApprovedAmount: null,
    paymentStatus: "awaiting_payment",
    confirmedAt: new Date(),
    confirmedBy: "admin:1",
    ...overrides,
  };
}

describe("resolveTipBasisAmount", () => {
  it("Pay Per Cleaning: uses amount_due_from_customer directly", async () => {
    const { repo } = createFakeSchedulingRepository();
    const basis = await resolveTipBasisAmount(repo, baseVisit(), basePricing({ amountDueFromCustomer: 179 }));
    expect(basis).toBe(179);
  });

  it("Prepaid: uses effective_price_per_visit + approved add_on_amount, never the visit's own $0 amount_due_from_customer", async () => {
    const prepaidPackage: PrepaidPackageRow = {
      id: "package-1",
      customerId: "customer-1",
      bookingOrderId: "booking-1",
      frequency: "weekly",
      purchasedVisitCount: 6,
      remainingVisitCount: 5,
      effectivePricePerVisit: 134.1,
      status: "active",
      purchasedAt: new Date(),
    };
    const { repo } = createFakeSchedulingRepository({ prepaidPackages: [prepaidPackage] });
    const visit = baseVisit({ prepaidPackageId: "package-1" });
    const pricing = basePricing({ baseAmount: 0, addOnAmount: 35, amountDueFromCustomer: 35 }); // package base covered, only extras owed

    const basis = await resolveTipBasisAmount(repo, visit, pricing);
    expect(basis).toBe(134.1 + 35);
  });

  it("throws if the linked prepaid package cannot be found", async () => {
    const { repo } = createFakeSchedulingRepository();
    const visit = baseVisit({ prepaidPackageId: "does-not-exist" });
    await expect(resolveTipBasisAmount(repo, visit, basePricing())).rejects.toThrow(InvalidVisitStateError);
  });
});
