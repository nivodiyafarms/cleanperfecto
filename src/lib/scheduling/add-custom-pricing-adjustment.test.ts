import { describe, expect, it } from "vitest";
import { createFakeBookingRepository } from "@/lib/booking/test-support/fake-booking-repository";
import type { CalculationInput } from "@/lib/pricing/types";
import { roundToCents } from "@/lib/pricing/money";
import { addCustomPricingAdjustment } from "./add-custom-pricing-adjustment";
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

async function seedWorkFinishedVisit(
  repo: ReturnType<typeof createFakeSchedulingRepository>["repo"],
  state: ReturnType<typeof createFakeSchedulingRepository>["state"]
) {
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
  await proposeRecurringScopeChange(repo, {
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

  const initial = await estimateVisitPricing(repo, { serviceVisitId: visit.id, addOnIds: [] });
  await repo.confirmServiceVisitPricing(visit.id, "admin:1");

  const current = state.serviceVisitsById.get(visit.id)!;
  state.serviceVisitsById.set(visit.id, { ...current, status: "work_finished", workFinishedAt: new Date() });

  return { visit, baseAmount: initial.baseAmount };
}

describe("addCustomPricingAdjustment", () => {
  it("adds one custom charge as a positive line item on top of the existing base + add-ons total", async () => {
    const { repo, state } = createFakeSchedulingRepository();
    const { repo: bookingRepo } = createFakeBookingRepository();
    const { visit, baseAmount } = await seedWorkFinishedVisit(repo, state);

    const pricing = await addCustomPricingAdjustment(repo, bookingRepo, {
      serviceVisitId: visit.id,
      type: "custom_charge",
      description: "Extra deep clean of garage",
      amount: 45,
      actorAdminUserId: "admin:1",
      actorRole: "operations",
    });

    expect(pricing.customChargeAmount).toBe(45);
    expect(pricing.customAdjustments).toHaveLength(1);
    expect(pricing.customAdjustments[0]).toMatchObject({
      type: "custom_charge",
      description: "Extra deep clean of garage",
      amount: 45,
      addedByAdminUserId: "admin:1",
      addedByRole: "operations",
    });
    expect(pricing.totalAmount).toBe(roundToCents(baseAmount + 45));
    expect(pricing.amountDueFromCustomer).toBe(roundToCents(baseAmount + 45));
  });

  it("adds multiple custom charges, each as its own separate line item", async () => {
    const { repo, state } = createFakeSchedulingRepository();
    const { repo: bookingRepo } = createFakeBookingRepository();
    const { visit, baseAmount } = await seedWorkFinishedVisit(repo, state);

    await addCustomPricingAdjustment(repo, bookingRepo, {
      serviceVisitId: visit.id,
      type: "custom_charge",
      description: "Extra garage clean",
      amount: 45,
      actorAdminUserId: "admin:1",
      actorRole: "operations",
    });
    const pricing = await addCustomPricingAdjustment(repo, bookingRepo, {
      serviceVisitId: visit.id,
      type: "custom_charge",
      description: "Extra fridge deep clean",
      amount: 15,
      actorAdminUserId: "admin:1",
      actorRole: "operations",
    });

    expect(pricing.customAdjustments).toHaveLength(2);
    expect(pricing.customChargeAmount).toBe(60);
    expect(pricing.totalAmount).toBe(roundToCents(baseAmount + 60));
  });

  it("adds a custom discount/credit as a subtraction from the total, never as a signed negative amount on the row", async () => {
    const { repo, state } = createFakeSchedulingRepository();
    const { repo: bookingRepo } = createFakeBookingRepository();
    const { visit, baseAmount } = await seedWorkFinishedVisit(repo, state);

    const pricing = await addCustomPricingAdjustment(repo, bookingRepo, {
      serviceVisitId: visit.id,
      type: "custom_discount",
      description: "Goodwill credit for late arrival",
      amount: 25,
      actorAdminUserId: "owner:1",
      actorRole: "owner_admin",
    });

    expect(pricing.customAdjustments[0].amount).toBe(25);
    expect(pricing.customDiscountAmount).toBe(25);
    expect(pricing.totalAmount).toBe(roundToCents(baseAmount - 25));
  });

  it("supports multiple discounts/credits on the same visit, summed", async () => {
    const { repo, state } = createFakeSchedulingRepository();
    const { repo: bookingRepo } = createFakeBookingRepository();
    const { visit, baseAmount } = await seedWorkFinishedVisit(repo, state);

    await addCustomPricingAdjustment(repo, bookingRepo, {
      serviceVisitId: visit.id,
      type: "custom_discount",
      description: "Late arrival credit",
      amount: 10,
      actorAdminUserId: "owner:1",
      actorRole: "owner_admin",
    });
    const pricing = await addCustomPricingAdjustment(repo, bookingRepo, {
      serviceVisitId: visit.id,
      type: "custom_discount",
      description: "Missed detail credit",
      amount: 15,
      actorAdminUserId: "owner:1",
      actorRole: "owner_admin",
    });

    expect(pricing.customDiscountAmount).toBe(25);
    expect(pricing.totalAmount).toBe(roundToCents(baseAmount - 25));
  });

  it("combines a charge and a discount together into the net authoritative total", async () => {
    const { repo, state } = createFakeSchedulingRepository();
    const { repo: bookingRepo } = createFakeBookingRepository();
    const { visit, baseAmount } = await seedWorkFinishedVisit(repo, state);

    await addCustomPricingAdjustment(repo, bookingRepo, {
      serviceVisitId: visit.id,
      type: "custom_charge",
      description: "Extra garage clean",
      amount: 45,
      actorAdminUserId: "admin:1",
      actorRole: "operations",
    });
    const pricing = await addCustomPricingAdjustment(repo, bookingRepo, {
      serviceVisitId: visit.id,
      type: "custom_discount",
      description: "Loyalty credit",
      amount: 25,
      actorAdminUserId: "owner:1",
      actorRole: "owner_admin",
    });

    expect(pricing.customChargeAmount).toBe(45);
    expect(pricing.customDiscountAmount).toBe(25);
    expect(pricing.totalAmount).toBe(roundToCents(baseAmount + 45 - 25));
  });

  it("rejects a zero amount", async () => {
    const { repo, state } = createFakeSchedulingRepository();
    const { repo: bookingRepo } = createFakeBookingRepository();
    const { visit } = await seedWorkFinishedVisit(repo, state);

    await expect(
      addCustomPricingAdjustment(repo, bookingRepo, {
        serviceVisitId: visit.id,
        type: "custom_charge",
        description: "Zero charge",
        amount: 0,
        actorAdminUserId: "admin:1",
        actorRole: "operations",
      })
    ).rejects.toThrow(InvalidVisitStateError);
  });

  it("rejects a negative amount", async () => {
    const { repo, state } = createFakeSchedulingRepository();
    const { repo: bookingRepo } = createFakeBookingRepository();
    const { visit } = await seedWorkFinishedVisit(repo, state);

    await expect(
      addCustomPricingAdjustment(repo, bookingRepo, {
        serviceVisitId: visit.id,
        type: "custom_discount",
        description: "Negative-entered discount",
        amount: -25,
        actorAdminUserId: "owner:1",
        actorRole: "owner_admin",
      })
    ).rejects.toThrow(InvalidVisitStateError);
  });

  it("rejects a blank description", async () => {
    const { repo, state } = createFakeSchedulingRepository();
    const { repo: bookingRepo } = createFakeBookingRepository();
    const { visit } = await seedWorkFinishedVisit(repo, state);

    await expect(
      addCustomPricingAdjustment(repo, bookingRepo, {
        serviceVisitId: visit.id,
        type: "custom_charge",
        description: "   ",
        amount: 20,
        actorAdminUserId: "admin:1",
        actorRole: "operations",
      })
    ).rejects.toThrow(InvalidVisitStateError);
  });

  it("never lets a discount push the payable total below $0", async () => {
    const { repo, state } = createFakeSchedulingRepository();
    const { repo: bookingRepo } = createFakeBookingRepository();
    const { visit, baseAmount } = await seedWorkFinishedVisit(repo, state);

    await expect(
      addCustomPricingAdjustment(repo, bookingRepo, {
        serviceVisitId: visit.id,
        type: "custom_discount",
        description: "Way too large credit",
        amount: baseAmount + 1000,
        actorAdminUserId: "owner:1",
        actorRole: "owner_admin",
      })
    ).rejects.toThrow();
  });

  it("refuses to add a custom charge before the visit is work-finished", async () => {
    const { repo } = createFakeSchedulingRepository();
    const { repo: bookingRepo } = createFakeBookingRepository();
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
      visitNumber: 1,
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

    await expect(
      addCustomPricingAdjustment(repo, bookingRepo, {
        serviceVisitId: visit.id,
        type: "custom_charge",
        description: "Too early",
        amount: 20,
        actorAdminUserId: "admin:1",
        actorRole: "operations",
      })
    ).rejects.toThrow(InvalidVisitStateError);
  });

  it("recomputes the authoritative total server-side as base + add-ons + custom charge - custom discount", async () => {
    const { repo, state } = createFakeSchedulingRepository();
    const { repo: bookingRepo } = createFakeBookingRepository();
    const { visit, baseAmount } = await seedWorkFinishedVisit(repo, state);
    await repo.upsertServiceVisitPricing({
      serviceVisitId: visit.id,
      pricingVersion: "v1",
      pricingSnapshot: {},
      baseAmount,
      addOnIds: ["inside_oven"],
      addOnAmount: 30,
      totalAmount: baseAmount + 30,
      amountDueFromCustomer: baseAmount + 30,
      priceStatus: "estimated",
      requiresCustomerApproval: false,
      previouslyApprovedAmount: baseAmount,
    });

    const pricing = await addCustomPricingAdjustment(repo, bookingRepo, {
      serviceVisitId: visit.id,
      type: "custom_charge",
      description: "Extra charge",
      amount: 10,
      actorAdminUserId: "admin:1",
      actorRole: "operations",
    });

    expect(pricing.addOnAmount).toBe(30);
    expect(pricing.customChargeAmount).toBe(10);
    expect(pricing.totalAmount).toBe(roundToCents(baseAmount + 30 + 10));
  });

  it("requires customer approval when a custom charge pushes the total above the previously approved amount", async () => {
    const { repo, state } = createFakeSchedulingRepository();
    const { repo: bookingRepo } = createFakeBookingRepository();
    const { visit } = await seedWorkFinishedVisit(repo, state);

    const pricing = await addCustomPricingAdjustment(repo, bookingRepo, {
      serviceVisitId: visit.id,
      type: "custom_charge",
      description: "Extra charge",
      amount: 45,
      actorAdminUserId: "admin:1",
      actorRole: "operations",
    });

    expect(pricing.requiresCustomerApproval).toBe(true);
    expect(pricing.priceStatus).toBe("pending_customer_approval");
  });

  it("does not require customer approval for a discount alone, since the total only decreases", async () => {
    const { repo, state } = createFakeSchedulingRepository();
    const { repo: bookingRepo } = createFakeBookingRepository();
    const { visit } = await seedWorkFinishedVisit(repo, state);

    const pricing = await addCustomPricingAdjustment(repo, bookingRepo, {
      serviceVisitId: visit.id,
      type: "custom_discount",
      description: "Loyalty credit",
      amount: 25,
      actorAdminUserId: "owner:1",
      actorRole: "owner_admin",
    });

    expect(pricing.requiresCustomerApproval).toBe(false);
  });

  it("determines approval from the net amount when a charge and discount are combined — not a simplistic any-charge rule", async () => {
    const { repo, state } = createFakeSchedulingRepository();
    const { repo: bookingRepo } = createFakeBookingRepository();
    const { visit } = await seedWorkFinishedVisit(repo, state);

    await addCustomPricingAdjustment(repo, bookingRepo, {
      serviceVisitId: visit.id,
      type: "custom_charge",
      description: "Small extra charge",
      amount: 5,
      actorAdminUserId: "admin:1",
      actorRole: "operations",
    });
    const pricing = await addCustomPricingAdjustment(repo, bookingRepo, {
      serviceVisitId: visit.id,
      type: "custom_discount",
      description: "Offsetting credit",
      amount: 20,
      actorAdminUserId: "owner:1",
      actorRole: "owner_admin",
    });

    // net change is -15 versus the previously approved amount, so no approval is required
    expect(pricing.requiresCustomerApproval).toBe(false);
  });

  it("writes a financial_audit_log row with the description, amount, adjustment type, acting admin, and timestamp", async () => {
    const { repo, state } = createFakeSchedulingRepository();
    const { repo: bookingRepo } = createFakeBookingRepository();
    const { visit } = await seedWorkFinishedVisit(repo, state);

    await addCustomPricingAdjustment(repo, bookingRepo, {
      serviceVisitId: visit.id,
      type: "custom_charge",
      description: "Extra charge for audit test",
      amount: 45,
      actorAdminUserId: "admin:42",
      actorRole: "operations",
    });

    const entries = state.financialAuditLog.filter((e) => e.serviceVisitId === visit.id && e.actionType === "custom_charge_added");
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      actorAdminUserId: "admin:42",
      actorRole: "operations",
      reason: "Extra charge for audit test",
    });
    expect(entries[0].metadata).toMatchObject({ type: "custom_charge", description: "Extra charge for audit test", amount: 45 });
    expect(entries[0].createdAt).toBeInstanceOf(Date);
  });

  it("does not add the adjustment or its audit row if the audit log write fails — add and audit are atomic", async () => {
    const { repo, state } = createFakeSchedulingRepository();
    const { repo: bookingRepo } = createFakeBookingRepository();
    const { visit } = await seedWorkFinishedVisit(repo, state);
    const before = await repo.findServiceVisitPricingByVisitId(visit.id);

    state.financialAuditControl.simulateFailure = true;
    await expect(
      addCustomPricingAdjustment(repo, bookingRepo, {
        serviceVisitId: visit.id,
        type: "custom_charge",
        description: "Should not persist",
        amount: 45,
        actorAdminUserId: "admin:1",
        actorRole: "operations",
      })
    ).rejects.toThrow();
    state.financialAuditControl.simulateFailure = false;

    // The atomic guarantee covers the add-adjustment-and-audit RPC itself —
    // no adjustment was appended and no audit row exists for it. (The
    // earlier, unrelated recompute this domain function also performs
    // before that RPC runs may still persist a same-or-lower re-estimate,
    // exactly as any other pricing recompute would — that step is not part
    // of what's being asserted atomic here.)
    const after = await repo.findServiceVisitPricingByVisitId(visit.id);
    expect(after?.customAdjustments).toEqual(before?.customAdjustments ?? []);
    expect(after?.customChargeAmount).toBe(before?.customChargeAmount ?? 0);
    expect(after?.customDiscountAmount).toBe(before?.customDiscountAmount ?? 0);
    expect(state.financialAuditLog.filter((e) => e.serviceVisitId === visit.id && e.actionType === "custom_charge_added")).toHaveLength(0);
  });

  it("existing predefined add-ons continue to work unchanged alongside a custom charge", async () => {
    const { repo, state } = createFakeSchedulingRepository();
    const { repo: bookingRepo } = createFakeBookingRepository();
    const { visit, baseAmount } = await seedWorkFinishedVisit(repo, state);
    await repo.upsertServiceVisitPricing({
      serviceVisitId: visit.id,
      pricingVersion: "v1",
      pricingSnapshot: {},
      baseAmount,
      addOnIds: ["inside_oven", "inside_refrigerator"],
      addOnAmount: 65,
      totalAmount: baseAmount + 65,
      amountDueFromCustomer: baseAmount + 65,
      priceStatus: "estimated",
      requiresCustomerApproval: false,
      previouslyApprovedAmount: baseAmount,
    });

    const pricing = await addCustomPricingAdjustment(repo, bookingRepo, {
      serviceVisitId: visit.id,
      type: "custom_charge",
      description: "Extra charge",
      amount: 20,
      actorAdminUserId: "admin:1",
      actorRole: "operations",
    });

    expect(pricing.addOnIds).toEqual(["inside_oven", "inside_refrigerator"]);
    expect(pricing.addOnAmount).toBe(65);
    expect(pricing.totalAmount).toBe(roundToCents(baseAmount + 65 + 20));
  });
});
