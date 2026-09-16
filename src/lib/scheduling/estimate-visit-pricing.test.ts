import { describe, expect, it } from "vitest";
import { calculateEstimate } from "@/lib/pricing/calculate-estimate";
import type { CalculationInput } from "@/lib/pricing/types";
import { createFakeBookingRepository } from "@/lib/booking/test-support/fake-booking-repository";
import { InvalidVisitStateError } from "./errors";
import { estimateVisitPricing } from "./estimate-visit-pricing";
import { proposeRecurringScopeChange } from "./propose-recurring-scope-change";
import { createFakeSchedulingRepository } from "./test-support/fake-scheduling-repository";

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

async function seedPpcVisitWithApprovedScope(repo: ReturnType<typeof createFakeSchedulingRepository>["repo"]) {
  const schedule = await repo.insertRecurringSchedule({
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
  const version = await proposeRecurringScopeChange(repo, {
    recurringScheduleId: schedule.id,
    customerId: "customer-1",
    newBaseInput: BASE_INPUT,
    effectiveFromVisitNumber: 1,
  });

  const visit = await repo.insertServiceVisit({
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

  return { schedule, version, visit };
}

describe("estimateVisitPricing", () => {
  it("Pay Per Cleaning: amountDueFromCustomer equals the full total (base + add-ons)", async () => {
    const { repo } = createFakeSchedulingRepository();
    const { visit } = await seedPpcVisitWithApprovedScope(repo);

    const pricing = await estimateVisitPricing(repo, { serviceVisitId: visit.id, addOnIds: ["inside_oven"] });

    expect(pricing.baseAmount).toBeGreaterThan(0);
    expect(pricing.addOnAmount).toBe(30);
    expect(pricing.totalAmount).toBe(pricing.baseAmount + 30);
    expect(pricing.amountDueFromCustomer).toBe(pricing.totalAmount);
  });

  it("Prepaid package: base is covered (0), amountDueFromCustomer is add-ons only", async () => {
    const { repo } = createFakeSchedulingRepository();
    const schedule = await repo.insertRecurringSchedule({
      customerId: "customer-1",
      bookingOrderId: null,
      prepaidPackageId: "pkg-1",
      cadence: "weekly",
      preferredDayOfWeek: 1,
      preferredStartTime: "10:00",
      timezone: "America/Chicago",
      effectiveFrom: "2026-08-24",
      supersedesId: null,
    });
    const visit = await repo.insertServiceVisit({
      customerId: "customer-1",
      quoteRequestId: null,
      bookingOrderId: null,
      prepaidPackageId: "pkg-1",
      recurringScheduleId: schedule.id,
      visitNumber: 3,
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

    const pricing = await estimateVisitPricing(repo, {
      serviceVisitId: visit.id,
      addOnIds: ["inside_oven", "inside_refrigerator"],
    });

    expect(pricing.baseAmount).toBe(0);
    expect(pricing.addOnAmount).toBe(65);
    expect(pricing.amountDueFromCustomer).toBe(65);
  });

  it("does not consume a package credit or touch package pricing when estimating extras", async () => {
    const { repo, state } = createFakeSchedulingRepository({
      prepaidPackages: [
        {
          id: "pkg-1",
          customerId: "customer-1",
          bookingOrderId: "booking-1",
          frequency: "weekly",
          purchasedVisitCount: 6,
          remainingVisitCount: 4,
          effectivePricePerVisit: 130,
          status: "active",
          purchasedAt: new Date("2026-01-01T00:00:00Z"),
        },
      ],
    });
    const schedule = await repo.insertRecurringSchedule({
      customerId: "customer-1",
      bookingOrderId: null,
      prepaidPackageId: "pkg-1",
      cadence: "weekly",
      preferredDayOfWeek: 1,
      preferredStartTime: "10:00",
      timezone: "America/Chicago",
      effectiveFrom: "2026-08-24",
      supersedesId: null,
    });
    const visit = await repo.insertServiceVisit({
      customerId: "customer-1",
      quoteRequestId: null,
      bookingOrderId: null,
      prepaidPackageId: "pkg-1",
      recurringScheduleId: schedule.id,
      visitNumber: 3,
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

    await estimateVisitPricing(repo, { serviceVisitId: visit.id, addOnIds: ["inside_oven"] });

    expect(state.prepaidPackagesById.get("pkg-1")?.remainingVisitCount).toBe(4);
    expect(state.prepaidPackagesById.get("pkg-1")?.effectivePricePerVisit).toBe(130);
  });

  it("excludes manual-quote add-ons from add_on_amount", async () => {
    const { repo } = createFakeSchedulingRepository();
    const { visit } = await seedPpcVisitWithApprovedScope(repo);
    const pricing = await estimateVisitPricing(repo, { serviceVisitId: visit.id, addOnIds: ["inside_oven"] });
    expect(pricing.addOnIds).toEqual(["inside_oven"]);
  });

  it("refuses to estimate a Pay Per Cleaning visit with no approved scope version", async () => {
    const { repo } = createFakeSchedulingRepository();
    const schedule = await repo.insertRecurringSchedule({
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
    const visit = await repo.insertServiceVisit({
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

    await expect(estimateVisitPricing(repo, { serviceVisitId: visit.id, addOnIds: [] })).rejects.toThrow(InvalidVisitStateError);
  });

  it("sets requiresCustomerApproval only when a later estimate exceeds the previously confirmed amount", async () => {
    const { repo } = createFakeSchedulingRepository();
    const { visit } = await seedPpcVisitWithApprovedScope(repo);

    const first = await estimateVisitPricing(repo, { serviceVisitId: visit.id, addOnIds: [] });
    expect(first.requiresCustomerApproval).toBe(false); // nothing previously approved yet

    await repo.confirmServiceVisitPricing(visit.id, "admin:1");

    const second = await estimateVisitPricing(repo, { serviceVisitId: visit.id, addOnIds: ["inside_oven"] });
    expect(second.requiresCustomerApproval).toBe(true);

    const third = await estimateVisitPricing(repo, { serviceVisitId: visit.id, addOnIds: [] });
    expect(third.requiresCustomerApproval).toBe(false);
  });

  it("enqueues a pending pricing_approval_required notice when a re-estimate exceeds the previously confirmed amount", async () => {
    const { repo, state } = createFakeSchedulingRepository();
    const { visit } = await seedPpcVisitWithApprovedScope(repo);

    await estimateVisitPricing(repo, { serviceVisitId: visit.id, addOnIds: [] });
    await repo.confirmServiceVisitPricing(visit.id, "admin:1");

    await estimateVisitPricing(repo, { serviceVisitId: visit.id, addOnIds: ["inside_oven"] });

    const notices = [...state.notifications.values()].filter(
      (n) => n.serviceVisitId === visit.id && n.notificationType === "pricing_approval_required"
    );
    expect(notices.length).toBe(1);
    expect(notices[0].state).toBe("pending");
  });

  it("does not enqueue a pricing_approval_required notice when a re-estimate is the same or lower than the previously confirmed amount", async () => {
    const { repo, state } = createFakeSchedulingRepository();
    const { visit } = await seedPpcVisitWithApprovedScope(repo);

    const first = await estimateVisitPricing(repo, { serviceVisitId: visit.id, addOnIds: ["inside_oven"] });
    await repo.confirmServiceVisitPricing(visit.id, "admin:1");
    expect(first.requiresCustomerApproval).toBe(false);

    // Re-estimate with no add-ons — total drops back to base only, strictly lower.
    await estimateVisitPricing(repo, { serviceVisitId: visit.id, addOnIds: [] });

    const notices = [...state.notifications.values()].filter(
      (n) => n.serviceVisitId === visit.id && n.notificationType === "pricing_approval_required"
    );
    expect(notices.length).toBe(0);
  });
});

describe("estimateVisitPricing — directly-booked one-time visit", () => {
  async function seedDirectVisit(bookingRepo: ReturnType<typeof createFakeBookingRepository>["repo"], overrides: Partial<CalculationInput> = {}) {
    const calculationInput: CalculationInput = { ...BASE_INPUT, frequency: "one_time", ...overrides };
    const result = calculateEstimate(calculationInput);
    const bookingOrder = await bookingRepo.insertBookingOrder({
      customerId: "customer-1",
      quoteRequestId: "quote-1",
      clientRequestId: "client-req-1",
      bookingType: "normal",
      cleaningType: "standard",
      frequency: "one_time",
      visitCount: 1,
      paymentAuthorizationAcceptedAt: new Date("2026-08-24T00:00:00Z").toISOString(),
      pricingVersion: result.pricingVersion,
      pricingSnapshot: { input: calculationInput, result },
      calculatedTotal: result.calculatedTotal,
      displayRangeLower: result.range?.lower ?? null,
      displayRangeUpper: result.range?.upper ?? null,
      prepaidPackageTotal: null,
      effectivePricePerVisit: null,
      hasStartingAtPricing: result.hasStartingAtPricing,
      manualReviewReasons: result.manualReviewReasons,
      selectedAddOnIds: [],
      serviceAddressLine1: null,
      serviceAddressLine2: null,
      serviceCity: null,
      serviceState: null,
      serviceAddressIdentity: null,
      requestedDate: null,
      requestedTimeWindow: null,
      requestedStartTime: null,
      cancellationPolicyVersion: null,
    });

    const { repo } = createFakeSchedulingRepository();
    const visit = await repo.insertServiceVisit({
      customerId: "customer-1",
      quoteRequestId: "quote-1",
      bookingOrderId: bookingOrder.id,
      prepaidPackageId: null,
      recurringScheduleId: null,
      visitNumber: null,
      cleaningType: "standard",
      frequency: "one_time",
      requestedStartAt: null,
      timezone: "America/Chicago",
      serviceAddressLine1: null,
      serviceAddressLine2: null,
      serviceCity: null,
      serviceState: null,
      serviceAddressIdentity: null,
    });

    return { repo, bookingOrder, visit, calculatedTotal: result.calculatedTotal };
  }

  it("derives baseAmount from the booking order's own calculatedTotal — never recomputed", async () => {
    const { repo: bookingRepo } = createFakeBookingRepository();
    const { repo, visit, calculatedTotal } = await seedDirectVisit(bookingRepo);

    const pricing = await estimateVisitPricing(repo, { serviceVisitId: visit.id, addOnIds: [] }, bookingRepo);

    expect(pricing.baseAmount).toBe(calculatedTotal);
    expect(pricing.totalAmount).toBe(calculatedTotal);
    expect(pricing.amountDueFromCustomer).toBe(calculatedTotal);
  });

  it("adds per-visit priced add-ons on top of the booking order's base amount", async () => {
    const { repo: bookingRepo } = createFakeBookingRepository();
    const { repo, visit, calculatedTotal } = await seedDirectVisit(bookingRepo);

    const pricing = await estimateVisitPricing(repo, { serviceVisitId: visit.id, addOnIds: ["inside_oven"] }, bookingRepo);

    expect(pricing.addOnAmount).toBe(30);
    expect(pricing.totalAmount).toBe(calculatedTotal + 30);
  });

  it("refuses to estimate a directly-booked visit without a BookingRepository", async () => {
    const { repo: bookingRepo } = createFakeBookingRepository();
    const { repo, visit } = await seedDirectVisit(bookingRepo);

    await expect(estimateVisitPricing(repo, { serviceVisitId: visit.id, addOnIds: [] })).rejects.toThrow(InvalidVisitStateError);
  });

  it("refuses to estimate a visit with neither a recurring_schedule_id nor a booking_order_id", async () => {
    const { repo } = createFakeSchedulingRepository();
    const visit = await repo.insertServiceVisit({
      customerId: "customer-1",
      quoteRequestId: null,
      bookingOrderId: null,
      prepaidPackageId: null,
      recurringScheduleId: null,
      visitNumber: null,
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

    await expect(estimateVisitPricing(repo, { serviceVisitId: visit.id, addOnIds: [] }, createFakeBookingRepository().repo)).rejects.toThrow(
      InvalidVisitStateError
    );
  });

  it("requires customer approval only once a later re-estimate exceeds the confirmed amount, exactly like the recurring path", async () => {
    const { repo: bookingRepo } = createFakeBookingRepository();
    const { repo, visit } = await seedDirectVisit(bookingRepo);

    const first = await estimateVisitPricing(repo, { serviceVisitId: visit.id, addOnIds: [] }, bookingRepo);
    expect(first.requiresCustomerApproval).toBe(false);

    await repo.confirmServiceVisitPricing(visit.id, "admin:1");

    const second = await estimateVisitPricing(repo, { serviceVisitId: visit.id, addOnIds: ["inside_oven"] }, bookingRepo);
    expect(second.requiresCustomerApproval).toBe(true);
    expect(second.priceStatus).toBe("pending_customer_approval");
  });

  it("preserves the booking order's pricing snapshot and id in the visit pricing snapshot for traceability", async () => {
    const { repo: bookingRepo } = createFakeBookingRepository();
    const { repo, visit, bookingOrder } = await seedDirectVisit(bookingRepo);

    const pricing = await estimateVisitPricing(repo, { serviceVisitId: visit.id, addOnIds: [] }, bookingRepo);

    const snapshot = pricing.pricingSnapshot as Record<string, unknown>;
    expect(snapshot.baseSource).toBe("booking_order");
    expect(snapshot.bookingOrderId).toBe(bookingOrder.id);
  });
});
