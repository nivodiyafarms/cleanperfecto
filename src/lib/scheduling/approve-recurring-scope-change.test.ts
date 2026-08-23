import { describe, expect, it } from "vitest";
import type { CalculationInput } from "@/lib/pricing/types";
import { approveRecurringScopeChange, rejectRecurringScopeChange } from "./approve-recurring-scope-change";
import { InvalidVisitStateError } from "./errors";
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

/** The first proposal for a schedule always auto-activates (nothing previously approved to compare against) — a genuine price increase over it is what actually lands in pending_customer_approval, ready for these functions to act on. */
async function seedFirstActiveThenPendingIncrease(repo: ReturnType<typeof createFakeSchedulingRepository>["repo"], scheduleId: string) {
  const first = await proposeRecurringScopeChange(repo, {
    recurringScheduleId: scheduleId,
    customerId: "customer-1",
    newBaseInput: { ...BASE_INPUT, condition: "light" },
    effectiveFromVisitNumber: 1,
  });
  const pending = await proposeRecurringScopeChange(repo, {
    recurringScheduleId: scheduleId,
    customerId: "customer-1",
    newBaseInput: { ...BASE_INPUT, condition: "heavy" },
    effectiveFromVisitNumber: 3,
  });
  return { first, pending };
}

describe("approveRecurringScopeChange", () => {
  it("activates a pending (increased) version", async () => {
    const { repo } = createFakeSchedulingRepository();
    const schedule = await seedSchedule(repo);
    const { pending } = await seedFirstActiveThenPendingIncrease(repo, schedule.id);

    const approved = await approveRecurringScopeChange(repo, pending.id);
    expect(approved.status).toBe("active");
  });

  it("supersedes the previously-active version when approving a replacement", async () => {
    const { repo } = createFakeSchedulingRepository();
    const schedule = await seedSchedule(repo);
    const { first, pending } = await seedFirstActiveThenPendingIncrease(repo, schedule.id);

    await approveRecurringScopeChange(repo, pending.id);

    const oldOne = await repo.findRecurringScopeVersionById(first.id);
    expect(oldOne?.status).toBe("superseded");
  });

  it("refuses to approve a non-pending version twice", async () => {
    const { repo } = createFakeSchedulingRepository();
    const schedule = await seedSchedule(repo);
    const { pending } = await seedFirstActiveThenPendingIncrease(repo, schedule.id);

    await approveRecurringScopeChange(repo, pending.id);
    await expect(approveRecurringScopeChange(repo, pending.id)).rejects.toThrow(InvalidVisitStateError);
  });

  it("refuses to approve an already-active (auto-activated) version — nothing to approve", async () => {
    const { repo } = createFakeSchedulingRepository();
    const schedule = await seedSchedule(repo);
    const { first } = await seedFirstActiveThenPendingIncrease(repo, schedule.id);

    await expect(approveRecurringScopeChange(repo, first.id)).rejects.toThrow(InvalidVisitStateError);
  });
});

describe("rejectRecurringScopeChange", () => {
  it("marks a pending version rejected without touching the previously-active one", async () => {
    const { repo } = createFakeSchedulingRepository();
    const schedule = await seedSchedule(repo);
    const { first, pending } = await seedFirstActiveThenPendingIncrease(repo, schedule.id);

    const rejected = await rejectRecurringScopeChange(repo, pending.id);
    expect(rejected.status).toBe("rejected");

    const stillActive = await repo.findActiveRecurringScopeVersion(schedule.id);
    expect(stillActive?.id).toBe(first.id);
  });
});
