import { describe, expect, it } from "vitest";
import type { CalculationInput } from "@/lib/pricing/types";
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

async function seedSchedule(repo: ReturnType<typeof createFakeSchedulingRepository>["repo"]) {
  return repo.insertRecurringSchedule({
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
}

describe("proposeRecurringScopeChange", () => {
  it("auto-activates the very first version for a schedule (nothing previously approved to compare against)", async () => {
    const { repo } = createFakeSchedulingRepository();
    const schedule = await seedSchedule(repo);
    const version = await proposeRecurringScopeChange(repo, {
      recurringScheduleId: schedule.id,
      customerId: "customer-1",
      newBaseInput: BASE_INPUT,
      effectiveFromVisitNumber: 1,
    });
    expect(version.status).toBe("active");
    expect(version.approvedBaseAmount).toBeGreaterThan(0);
  });

  it("auto-activates a same-or-lower re-proposal without requiring a second customer approval", async () => {
    const { repo } = createFakeSchedulingRepository();
    const schedule = await seedSchedule(repo);
    const first = await proposeRecurringScopeChange(repo, {
      recurringScheduleId: schedule.id,
      customerId: "customer-1",
      newBaseInput: { ...BASE_INPUT, condition: "heavy" },
      effectiveFromVisitNumber: 1,
    });
    expect(first.status).toBe("active");

    // Same scope again (identical inputs -> identical, not higher, amount).
    const second = await proposeRecurringScopeChange(repo, {
      recurringScheduleId: schedule.id,
      customerId: "customer-1",
      newBaseInput: { ...BASE_INPUT, condition: "heavy" },
      effectiveFromVisitNumber: 2,
    });
    expect(second.status).toBe("active");

    const stillFirst = await repo.findRecurringScopeVersionById(first.id);
    expect(stillFirst?.status).toBe("superseded");
  });

  it("requires customer approval only when the new amount is a genuine increase over the previously-active amount", async () => {
    const { repo } = createFakeSchedulingRepository();
    const schedule = await seedSchedule(repo);
    const first = await proposeRecurringScopeChange(repo, {
      recurringScheduleId: schedule.id,
      customerId: "customer-1",
      newBaseInput: { ...BASE_INPUT, condition: "light" },
      effectiveFromVisitNumber: 1,
    });
    expect(first.status).toBe("active");

    const increased = await proposeRecurringScopeChange(repo, {
      recurringScheduleId: schedule.id,
      customerId: "customer-1",
      newBaseInput: { ...BASE_INPUT, condition: "heavy" }, // heavy costs strictly more than light
      effectiveFromVisitNumber: 3,
    });
    expect(increased.status).toBe("pending_customer_approval");
    expect(increased.approvedBaseAmount).toBeGreaterThan(first.approvedBaseAmount as number);

    // The previously-active version is untouched while the increase is pending.
    const stillFirst = await repo.findRecurringScopeVersionById(first.id);
    expect(stillFirst?.status).toBe("active");
  });

  it("never mutates a previously-active version in place", async () => {
    const { repo } = createFakeSchedulingRepository();
    const schedule = await seedSchedule(repo);
    const first = await proposeRecurringScopeChange(repo, {
      recurringScheduleId: schedule.id,
      customerId: "customer-1",
      newBaseInput: { ...BASE_INPUT, condition: "light" },
      effectiveFromVisitNumber: 1,
    });

    await proposeRecurringScopeChange(repo, {
      recurringScheduleId: schedule.id,
      customerId: "customer-1",
      newBaseInput: { ...BASE_INPUT, condition: "heavy" },
      effectiveFromVisitNumber: 3,
    });

    const stillThere = await repo.findRecurringScopeVersionById(first.id);
    expect(stillThere?.status).toBe("active");
    expect(stillThere?.approvedBaseAmount).toBe(first.approvedBaseAmount);
  });
});
