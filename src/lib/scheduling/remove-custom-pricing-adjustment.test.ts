import { describe, expect, it } from "vitest";
import { createFakeBookingRepository } from "@/lib/booking/test-support/fake-booking-repository";
import { roundToCents } from "@/lib/pricing/money";
import type { CalculationInput } from "@/lib/pricing/types";
import { addCustomPricingAdjustment } from "./add-custom-pricing-adjustment";
import { InvalidVisitStateError } from "./errors";
import { estimateVisitPricing } from "./estimate-visit-pricing";
import { proposeRecurringScopeChange } from "./propose-recurring-scope-change";
import { removeCustomPricingAdjustment } from "./remove-custom-pricing-adjustment";
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

describe("removeCustomPricingAdjustment", () => {
  it("removes a custom charge and restores the total to what it was before it was added", async () => {
    const { repo, state } = createFakeSchedulingRepository();
    const { repo: bookingRepo } = createFakeBookingRepository();
    const { visit, baseAmount } = await seedWorkFinishedVisit(repo, state);

    const added = await addCustomPricingAdjustment(repo, bookingRepo, {
      serviceVisitId: visit.id,
      type: "custom_charge",
      description: "Extra garage clean",
      amount: 45,
      actorAdminUserId: "admin:1",
      actorRole: "operations",
    });
    expect(added.totalAmount).toBe(baseAmount + 45);

    const removed = await removeCustomPricingAdjustment(repo, bookingRepo, {
      serviceVisitId: visit.id,
      adjustmentId: added.customAdjustments[0].id,
      actorAdminUserId: "admin:1",
      actorRole: "operations",
    });

    expect(removed.customAdjustments).toHaveLength(0);
    expect(removed.customChargeAmount).toBe(0);
    expect(removed.totalAmount).toBe(baseAmount);
  });

  it("removes a custom discount/credit and restores the higher total, updating requiresCustomerApproval accordingly", async () => {
    const { repo, state } = createFakeSchedulingRepository();
    const { repo: bookingRepo } = createFakeBookingRepository();
    const { visit, baseAmount } = await seedWorkFinishedVisit(repo, state);

    const added = await addCustomPricingAdjustment(repo, bookingRepo, {
      serviceVisitId: visit.id,
      type: "custom_discount",
      description: "Loyalty credit",
      amount: 25,
      actorAdminUserId: "owner:1",
      actorRole: "owner_admin",
    });
    expect(added.totalAmount).toBe(roundToCents(baseAmount - 25));
    expect(added.requiresCustomerApproval).toBe(false);

    const removed = await removeCustomPricingAdjustment(repo, bookingRepo, {
      serviceVisitId: visit.id,
      adjustmentId: added.customAdjustments[0].id,
      actorAdminUserId: "owner:1",
      actorRole: "owner_admin",
    });

    expect(removed.customDiscountAmount).toBe(0);
    expect(removed.totalAmount).toBe(baseAmount);
    // back to exactly the previously approved amount — same-or-lower, never blocks
    expect(removed.requiresCustomerApproval).toBe(false);
  });

  it("removing one of several adjustments leaves the others intact", async () => {
    const { repo, state } = createFakeSchedulingRepository();
    const { repo: bookingRepo } = createFakeBookingRepository();
    const { visit, baseAmount } = await seedWorkFinishedVisit(repo, state);

    await addCustomPricingAdjustment(repo, bookingRepo, {
      serviceVisitId: visit.id,
      type: "custom_charge",
      description: "First extra",
      amount: 20,
      actorAdminUserId: "admin:1",
      actorRole: "operations",
    });
    const second = await addCustomPricingAdjustment(repo, bookingRepo, {
      serviceVisitId: visit.id,
      type: "custom_charge",
      description: "Second extra",
      amount: 30,
      actorAdminUserId: "admin:1",
      actorRole: "operations",
    });
    expect(second.customAdjustments).toHaveLength(2);

    const firstAdjustmentId = second.customAdjustments.find((a) => a.description === "First extra")!.id;
    const removed = await removeCustomPricingAdjustment(repo, bookingRepo, {
      serviceVisitId: visit.id,
      adjustmentId: firstAdjustmentId,
      actorAdminUserId: "admin:1",
      actorRole: "operations",
    });

    expect(removed.customAdjustments).toHaveLength(1);
    expect(removed.customAdjustments[0].description).toBe("Second extra");
    expect(removed.customChargeAmount).toBe(30);
    expect(removed.totalAmount).toBe(baseAmount + 30);
  });

  it("fails safely when removing a nonexistent adjustment id, without mutating existing state", async () => {
    const { repo, state } = createFakeSchedulingRepository();
    const { repo: bookingRepo } = createFakeBookingRepository();
    const { visit } = await seedWorkFinishedVisit(repo, state);
    await addCustomPricingAdjustment(repo, bookingRepo, {
      serviceVisitId: visit.id,
      type: "custom_charge",
      description: "Real charge",
      amount: 20,
      actorAdminUserId: "admin:1",
      actorRole: "operations",
    });
    const before = await repo.findServiceVisitPricingByVisitId(visit.id);

    await expect(
      removeCustomPricingAdjustment(repo, bookingRepo, {
        serviceVisitId: visit.id,
        adjustmentId: "does-not-exist",
        actorAdminUserId: "admin:1",
        actorRole: "operations",
      })
    ).rejects.toThrow();

    const after = await repo.findServiceVisitPricingByVisitId(visit.id);
    expect(after).toEqual(before);
  });

  it("refuses to remove an adjustment before the visit is work-finished", async () => {
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
      removeCustomPricingAdjustment(repo, bookingRepo, {
        serviceVisitId: visit.id,
        adjustmentId: "whatever",
        actorAdminUserId: "admin:1",
        actorRole: "operations",
      })
    ).rejects.toThrow(InvalidVisitStateError);
  });

  it("writes a financial_audit_log removal row with the description, amount, adjustment type, acting admin, and timestamp", async () => {
    const { repo, state } = createFakeSchedulingRepository();
    const { repo: bookingRepo } = createFakeBookingRepository();
    const { visit } = await seedWorkFinishedVisit(repo, state);
    const added = await addCustomPricingAdjustment(repo, bookingRepo, {
      serviceVisitId: visit.id,
      type: "custom_discount",
      description: "Credit to remove",
      amount: 15,
      actorAdminUserId: "owner:1",
      actorRole: "owner_admin",
    });

    await removeCustomPricingAdjustment(repo, bookingRepo, {
      serviceVisitId: visit.id,
      adjustmentId: added.customAdjustments[0].id,
      actorAdminUserId: "owner:9",
      actorRole: "owner_admin",
    });

    const entries = state.financialAuditLog.filter((e) => e.serviceVisitId === visit.id && e.actionType === "custom_discount_removed");
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ actorAdminUserId: "owner:9", actorRole: "owner_admin", reason: "Credit to remove" });
    expect(entries[0].metadata).toMatchObject({ type: "custom_discount", description: "Credit to remove", amount: 15 });
    expect(entries[0].createdAt).toBeInstanceOf(Date);
  });
});
