import { describe, expect, it } from "vitest";
import { completeServiceVisit } from "./complete-service-visit";
import { confirmServiceVisit } from "./confirm-service-visit";
import { InvalidVisitStateError } from "./errors";
import { planRecurringVisitDates } from "./plan-recurring-visit-dates";
import { scheduleRecurringVisitPlan } from "./schedule-recurring-visit-plan";
import { createFakeSchedulingRepository } from "./test-support/fake-scheduling-repository";

const DURATION_INPUT = { cleaningType: "standard" as const, sizeTier: "2br_2ba" as const, condition: "light" as const };

async function seedScheduleAndPlans(
  repo: ReturnType<typeof createFakeSchedulingRepository>["repo"],
  prepaidPackageId: string | null
) {
  const schedule = await repo.insertRecurringSchedule({
    customerId: "customer-1",
    bookingOrderId: prepaidPackageId ? null : "booking-1",
    prepaidPackageId,
    cadence: "weekly",
    preferredDayOfWeek: 1,
    preferredStartTime: "10:00",
    timezone: "America/Chicago",
    effectiveFrom: "2026-08-24",
    supersedesId: null,
  });
  const plans = await planRecurringVisitDates(repo, {
    recurringScheduleId: schedule.id,
    customerId: "customer-1",
    cadence: "weekly",
    firstDate: "2026-08-24",
    firstStartTime: "10:00",
  });
  return { schedule, plans };
}

describe("scheduleRecurringVisitPlan", () => {
  it("draws a credit from the customer's active prepaid package when one has remaining credit", async () => {
    const { repo } = createFakeSchedulingRepository({
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
    const { plans } = await seedScheduleAndPlans(repo, "pkg-1");

    const result = await scheduleRecurringVisitPlan(repo, {
      recurringVisitPlanId: plans[0].id,
      recurringScheduleId: plans[0].recurringScheduleId,
      customerId: "customer-1",
      cleaningType: "standard",
      serviceAddressLine1: null,
      serviceAddressLine2: null,
      serviceCity: null,
      serviceState: null,
      serviceAddressIdentity: null,
    });

    expect(result.prepaidPackageId).toBe("pkg-1");
  });

  it("produces a Pay Per Cleaning visit (no prepaidPackageId) once the customer's package credit is exhausted", async () => {
    const { repo } = createFakeSchedulingRepository({
      prepaidPackages: [
        {
          id: "pkg-1",
          customerId: "customer-1",
          bookingOrderId: "booking-1",
          frequency: "weekly",
          purchasedVisitCount: 6,
          remainingVisitCount: 0,
          effectivePricePerVisit: 130,
          status: "active",
          purchasedAt: new Date("2026-01-01T00:00:00Z"),
        },
      ],
    });
    const { plans } = await seedScheduleAndPlans(repo, "pkg-1");

    const result = await scheduleRecurringVisitPlan(repo, {
      recurringVisitPlanId: plans[0].id,
      recurringScheduleId: plans[0].recurringScheduleId,
      customerId: "customer-1",
      cleaningType: "standard",
      serviceAddressLine1: null,
      serviceAddressLine2: null,
      serviceCity: null,
      serviceState: null,
      serviceAddressIdentity: null,
    });

    expect(result.prepaidPackageId).toBeNull();
  });

  it("produces a Pay Per Cleaning visit for a customer with no package at all", async () => {
    const { repo } = createFakeSchedulingRepository();
    const { plans } = await seedScheduleAndPlans(repo, null);

    const result = await scheduleRecurringVisitPlan(repo, {
      recurringVisitPlanId: plans[0].id,
      recurringScheduleId: plans[0].recurringScheduleId,
      customerId: "customer-1",
      cleaningType: "standard",
      serviceAddressLine1: null,
      serviceAddressLine2: null,
      serviceCity: null,
      serviceState: null,
      serviceAddressIdentity: null,
    });

    expect(result.prepaidPackageId).toBeNull();
  });

  it("links the plan to the created visit and is idempotent on repeat calls", async () => {
    const { repo, state } = createFakeSchedulingRepository();
    const { plans } = await seedScheduleAndPlans(repo, null);

    const first = await scheduleRecurringVisitPlan(repo, {
      recurringVisitPlanId: plans[0].id,
      recurringScheduleId: plans[0].recurringScheduleId,
      customerId: "customer-1",
      cleaningType: "standard",
      serviceAddressLine1: null,
      serviceAddressLine2: null,
      serviceCity: null,
      serviceState: null,
      serviceAddressIdentity: null,
    });
    expect(first.alreadyLinked).toBe(false);
    expect(state.recurringVisitPlansById.get(plans[0].id)?.status).toBe("linked");

    const second = await scheduleRecurringVisitPlan(repo, {
      recurringVisitPlanId: plans[0].id,
      recurringScheduleId: plans[0].recurringScheduleId,
      customerId: "customer-1",
      cleaningType: "standard",
      serviceAddressLine1: null,
      serviceAddressLine2: null,
      serviceCity: null,
      serviceState: null,
      serviceAddressIdentity: null,
    });
    expect(second.alreadyLinked).toBe(true);
    expect(second.visitId).toBe(first.visitId);
    expect(state.serviceVisitsById.size).toBe(1);
  });

  it("does not stop the recurring schedule once package credit is exhausted — later visits continue as Pay Per Cleaning under the same schedule", async () => {
    const { repo, state } = createFakeSchedulingRepository({
      cleaners: [{ id: "cleaner-1", name: "A", active: true }],
      prepaidPackages: [
        {
          id: "pkg-1",
          customerId: "customer-1",
          bookingOrderId: "booking-1",
          frequency: "weekly",
          purchasedVisitCount: 4,
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
    const plans = await planRecurringVisitDates(repo, {
      recurringScheduleId: schedule.id,
      customerId: "customer-1",
      cadence: "weekly",
      firstDate: "2026-08-24",
      firstStartTime: "10:00",
    });

    // Schedule, confirm, and complete all 4 package-covered visits — this
    // exhausts the package's credit (remainingVisitCount -> 0) while the
    // recurring_schedule itself stays active.
    for (let i = 0; i < 4; i++) {
      const { visitId, prepaidPackageId } = await scheduleRecurringVisitPlan(repo, {
        recurringVisitPlanId: plans[i].id,
        recurringScheduleId: schedule.id,
        customerId: "customer-1",
        cleaningType: "standard",
        serviceAddressLine1: null,
        serviceAddressLine2: null,
        serviceCity: null,
        serviceState: null,
        serviceAddressIdentity: null,
      });
      expect(prepaidPackageId).toBe("pkg-1");
      await confirmServiceVisit(repo, {
        serviceVisitId: visitId,
        date: plans[i].plannedDate,
        startTime: "10:00",
        cleanerIds: ["cleaner-1"],
        durationInput: DURATION_INPUT,
      });
      await completeServiceVisit(repo, visitId);
    }

    expect(state.prepaidPackagesById.get("pkg-1")?.remainingVisitCount).toBe(0);
    // Each completion replenished the horizon — the schedule kept producing
    // future dates rather than stopping at 4.
    expect(state.recurringVisitPlansById.size).toBeGreaterThan(4);
    expect((await repo.findRecurringScheduleById(schedule.id))?.status).toBe("active");

    // The 5th occurrence (visit_number 5), scheduled now that credit is
    // exhausted, is Pay Per Cleaning under the very same schedule.
    const remainingPlans = await repo.listRecurringVisitPlans(schedule.id);
    const fifthPlan = remainingPlans.find((p) => p.visitNumber === 5)!;
    const fifth = await scheduleRecurringVisitPlan(repo, {
      recurringVisitPlanId: fifthPlan.id,
      recurringScheduleId: schedule.id,
      customerId: "customer-1",
      cleaningType: "standard",
      serviceAddressLine1: null,
      serviceAddressLine2: null,
      serviceCity: null,
      serviceState: null,
      serviceAddressIdentity: null,
    });
    expect(fifth.prepaidPackageId).toBeNull();
  });

  it("rejects when the submitted schedule/customer doesn't match the targeted plan — both at the friendly check and at the atomic claim itself", async () => {
    const { repo } = createFakeSchedulingRepository();
    const { schedule, plans } = await seedScheduleAndPlans(repo, null);

    const otherSchedule = await repo.insertRecurringSchedule({
      customerId: "customer-2",
      bookingOrderId: "booking-2",
      prepaidPackageId: null,
      cadence: "weekly",
      preferredDayOfWeek: 1,
      preferredStartTime: "10:00",
      timezone: "America/Chicago",
      effectiveFrom: "2026-08-24",
      supersedesId: null,
    });

    // Wrong recurringScheduleId, correct customerId.
    await expect(
      scheduleRecurringVisitPlan(repo, {
        recurringVisitPlanId: plans[0].id,
        recurringScheduleId: otherSchedule.id,
        customerId: "customer-1",
        cleaningType: "standard",
        serviceAddressLine1: null,
        serviceAddressLine2: null,
        serviceCity: null,
        serviceState: null,
        serviceAddressIdentity: null,
      })
    ).rejects.toThrow(InvalidVisitStateError);

    // Correct recurringScheduleId, wrong customerId.
    await expect(
      scheduleRecurringVisitPlan(repo, {
        recurringVisitPlanId: plans[0].id,
        recurringScheduleId: schedule.id,
        customerId: "customer-2",
        cleaningType: "standard",
        serviceAddressLine1: null,
        serviceAddressLine2: null,
        serviceCity: null,
        serviceState: null,
        serviceAddressIdentity: null,
      })
    ).rejects.toThrow(InvalidVisitStateError);

    // The authoritative, row-locked claim itself also rejects the mismatch —
    // called directly here to prove the guarantee doesn't rely solely on the
    // friendly pre-check above (which production's RPC enforces atomically
    // under `select ... for update`; the fake mirrors that same rejection).
    await expect(
      repo.claimAndScheduleRecurringVisitPlan({
        recurringVisitPlanId: plans[0].id,
        recurringScheduleId: otherSchedule.id,
        customerId: "customer-1",
        prepaidPackageId: null,
        cleaningType: "standard",
        requestedStartAt: new Date("2026-08-24T15:00:00Z"),
        timezone: "America/Chicago",
        serviceAddressLine1: null,
        serviceAddressLine2: null,
        serviceCity: null,
        serviceState: null,
        serviceAddressIdentity: null,
      })
    ).rejects.toThrow(InvalidVisitStateError);

    // Nothing was ever created or mutated by any of the rejected attempts.
    const untouched = await repo.findRecurringVisitPlanById(plans[0].id);
    expect(untouched?.status).toBe("planned");
    expect(untouched?.serviceVisitId).toBeNull();
  });

  it("creates exactly one visit under genuinely concurrent double-submission of the same plan", async () => {
    const { repo, state } = createFakeSchedulingRepository();
    const { plans } = await seedScheduleAndPlans(repo, null);

    const submit = () =>
      scheduleRecurringVisitPlan(repo, {
        recurringVisitPlanId: plans[0].id,
        recurringScheduleId: plans[0].recurringScheduleId,
        customerId: "customer-1",
        cleaningType: "standard",
        serviceAddressLine1: null,
        serviceAddressLine2: null,
        serviceCity: null,
        serviceState: null,
        serviceAddressIdentity: null,
      });

    // Two genuinely interleaved calls — not sequential awaits — racing for
    // the same plan's row lock, the same way two simultaneous admin
    // button-clicks (or a retried request) would.
    const [first, second] = await Promise.all([submit(), submit()]);

    expect([first.alreadyLinked, second.alreadyLinked].sort()).toEqual([false, true]);
    expect(first.visitId).toBe(second.visitId);
    expect(state.serviceVisitsById.size).toBe(1);
  });
});
