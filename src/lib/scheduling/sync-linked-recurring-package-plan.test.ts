import { describe, expect, it } from "vitest";
import { activatePrepaidPackageCalendar } from "./activate-prepaid-package-calendar";
import { completeServiceVisit } from "./complete-service-visit";
import { confirmServiceVisit } from "./confirm-service-visit";
import { replanPackageCadence } from "./replan-package-cadence";
import { replanPackageVisit } from "./replan-package-visit";
import { replanRecurringCadence } from "./replan-recurring-cadence";
import { replanRecurringVisit } from "./replan-recurring-visit";
import { schedulePackageVisitPlan } from "./schedule-package-visit-plan";
import { scheduleRecurringVisitPlan } from "./schedule-recurring-visit-plan";
import { createFakeSchedulingRepository } from "./test-support/fake-scheduling-repository";

const DURATION_INPUT = { cleaningType: "standard" as const, sizeTier: "2br_2ba" as const, condition: "light" as const };

function seedActivePackage(id: string) {
  return createFakeSchedulingRepository({
    cleaners: [{ id: "cleaner-1", name: "A", active: true }],
    prepaidPackages: [
      {
        id,
        customerId: "customer-1",
        bookingOrderId: "booking-1",
        frequency: "weekly",
        purchasedVisitCount: 6,
        remainingVisitCount: 6,
        effectivePricePerVisit: 130,
        status: "active",
        purchasedAt: new Date("2026-01-01T00:00:00Z"),
      },
    ],
  });
}

async function seedLinkedCalendar(repo: ReturnType<typeof seedActivePackage>["repo"]) {
  const { packagePlans, recurringPlans } = await activatePrepaidPackageCalendar(repo, {
    prepaidPackageId: "pkg-1",
    customerId: "customer-1",
    cadence: "weekly",
    firstDate: "2026-08-24",
    firstStartTime: "10:00",
  });
  return { packagePlans, recurringPlans };
}

describe("package_visit_plans <-> recurring_visit_plans synchronization", () => {
  it("change-one via the admin package-specific path (replanPackageVisit) updates the linked universal plan too", async () => {
    const { repo } = seedActivePackage("pkg-1");
    const { packagePlans } = await seedLinkedCalendar(repo);

    await replanPackageVisit(repo, {
      packageVisitPlanId: packagePlans[2].id,
      newPlannedDate: "2026-09-20",
      newPlannedStartTime: "13:00",
    });

    const packagePlan = await repo.findPackageVisitPlanById(packagePlans[2].id);
    const linkedRecurringPlan = await repo.findRecurringVisitPlanById(packagePlan?.recurringVisitPlanId as string);
    expect(linkedRecurringPlan?.plannedDate).toBe("2026-09-20");
    expect(linkedRecurringPlan?.plannedStartTime).toBe("13:00");
  });

  it("change-one via the universal/portal path (replanRecurringVisit) updates the linked package plan too", async () => {
    const { repo } = seedActivePackage("pkg-1");
    const { packagePlans, recurringPlans } = await seedLinkedCalendar(repo);

    await replanRecurringVisit(repo, {
      recurringVisitPlanId: recurringPlans[2].id,
      newPlannedDate: "2026-09-22",
      newPlannedStartTime: "14:00",
    });

    const linkedPackagePlan = await repo.findPackageVisitPlanById(packagePlans[2].id);
    expect(linkedPackagePlan?.plannedDate).toBe("2026-09-22");
    expect(linkedPackagePlan?.plannedStartTime).toBe("14:00");
  });

  it("linking at schedule time (admin's schedulePackageVisitPlan) marks the universal plan 'linked' to the same service_visit", async () => {
    const { repo } = seedActivePackage("pkg-1");
    const { packagePlans } = await seedLinkedCalendar(repo);

    const { visitId } = await schedulePackageVisitPlan(repo, {
      packageVisitPlanId: packagePlans[0].id,
      customerId: "customer-1",
      cleaningType: "standard",
      serviceAddressLine1: null,
      serviceAddressLine2: null,
      serviceCity: null,
      serviceState: null,
      serviceAddressIdentity: null,
    });

    const packagePlan = await repo.findPackageVisitPlanById(packagePlans[0].id);
    const linkedRecurringPlan = await repo.findRecurringVisitPlanById(packagePlan?.recurringVisitPlanId as string);
    expect(linkedRecurringPlan?.status).toBe("linked");
    expect(linkedRecurringPlan?.serviceVisitId).toBe(visitId);
  });

  it("linking at schedule time (portal's scheduleRecurringVisitPlan) marks the package plan 'linked' to the same service_visit", async () => {
    const { repo } = seedActivePackage("pkg-1");
    const { packagePlans, recurringPlans } = await seedLinkedCalendar(repo);

    const { visitId } = await scheduleRecurringVisitPlan(repo, {
      recurringVisitPlanId: recurringPlans[1].id,
      recurringScheduleId: recurringPlans[1].recurringScheduleId,
      customerId: "customer-1",
      cleaningType: "standard",
      serviceAddressLine1: null,
      serviceAddressLine2: null,
      serviceCity: null,
      serviceState: null,
      serviceAddressIdentity: null,
    });

    const linkedPackagePlan = await repo.findPackageVisitPlanById(packagePlans[1].id);
    expect(linkedPackagePlan?.status).toBe("linked");
    expect(linkedPackagePlan?.serviceVisitId).toBe(visitId);
  });

  it("linking at schedule time rolls back and retries cleanly when the package-plan sync fails", async () => {
    const { repo, state } = seedActivePackage("pkg-1");
    const { packagePlans, recurringPlans } = await seedLinkedCalendar(repo);

    const originalInsertPackageHistory = repo.insertPackageVisitPlanHistory.bind(repo);
    let shouldFail = true;
    repo.insertPackageVisitPlanHistory = async (row) => {
      if (shouldFail) {
        shouldFail = false;
        throw new Error("Simulated failure: package_visit_plan_history insert");
      }
      return originalInsertPackageHistory(row);
    };

    const scheduleInput = {
      recurringVisitPlanId: recurringPlans[1].id,
      recurringScheduleId: recurringPlans[1].recurringScheduleId,
      customerId: "customer-1",
      cleaningType: "standard" as const,
      serviceAddressLine1: null,
      serviceAddressLine2: null,
      serviceCity: null,
      serviceState: null,
      serviceAddressIdentity: null,
    };

    await expect(scheduleRecurringVisitPlan(repo, scheduleInput)).rejects.toThrow(
      "Simulated failure: package_visit_plan_history insert"
    );

    // Nothing committed from the failed attempt: no visit, no recurring
    // plan link, and the package plan is still exactly as it was planned.
    expect(state.serviceVisitsById.size).toBe(0);
    const recurringPlanAfterFailure = await repo.findRecurringVisitPlanById(recurringPlans[1].id);
    expect(recurringPlanAfterFailure?.status).toBe("planned");
    const packagePlanAfterFailure = await repo.findPackageVisitPlanById(packagePlans[1].id);
    expect(packagePlanAfterFailure?.status).toBe("planned");
    expect(packagePlanAfterFailure?.serviceVisitId).toBeNull();
    // Only the pre-existing "initial_plan" history row from seeding — no
    // linked_to_visit row from the failed attempt.
    expect(state.packageVisitPlanHistory.filter((h) => h.packageVisitPlanId === packagePlans[1].id)).toHaveLength(1);

    const retried = await scheduleRecurringVisitPlan(repo, scheduleInput);
    expect(retried.alreadyLinked).toBe(false);

    expect(state.serviceVisitsById.size).toBe(1);
    const recurringPlanAfterRetry = await repo.findRecurringVisitPlanById(recurringPlans[1].id);
    expect(recurringPlanAfterRetry?.status).toBe("linked");
    expect(recurringPlanAfterRetry?.serviceVisitId).toBe(retried.visitId);
    const packagePlanAfterRetry = await repo.findPackageVisitPlanById(packagePlans[1].id);
    expect(packagePlanAfterRetry?.status).toBe("linked");
    expect(packagePlanAfterRetry?.serviceVisitId).toBe(retried.visitId);
    expect(state.packageVisitPlanHistory.filter((h) => h.packageVisitPlanId === packagePlans[1].id)).toHaveLength(2);

    // A second retry (now already linked) must not create a duplicate
    // visit or duplicate package-plan audit rows.
    const secondRetry = await scheduleRecurringVisitPlan(repo, scheduleInput);
    expect(secondRetry.alreadyLinked).toBe(true);
    expect(secondRetry.visitId).toBe(retried.visitId);
    expect(state.serviceVisitsById.size).toBe(1);
    expect(state.packageVisitPlanHistory.filter((h) => h.packageVisitPlanId === packagePlans[1].id)).toHaveLength(2);
  });

  it("change-this-and-future via the admin package path (replanPackageCadence) updates every still-linked universal counterpart", async () => {
    const { repo } = seedActivePackage("pkg-1");
    const { packagePlans } = await seedLinkedCalendar(repo);

    await replanPackageCadence(repo, {
      prepaidPackageId: "pkg-1",
      effectiveFromVisitNumber: 3,
      newCadence: "biweekly",
      newFirstDate: "2026-09-20",
      newFirstStartTime: "13:00",
    });

    for (const visitNumber of [3, 4, 5, 6]) {
      const packagePlan = packagePlans.find((p) => p.visitNumber === visitNumber);
      const updated = await repo.findPackageVisitPlanById(packagePlan!.id);
      const linkedRecurringPlan = await repo.findRecurringVisitPlanById(updated?.recurringVisitPlanId as string);
      expect(linkedRecurringPlan?.plannedDate).toBe(updated?.plannedDate);
      expect(linkedRecurringPlan?.plannedStartTime).toBe(updated?.plannedStartTime);
    }
  });

  it("change-this-and-future via the universal/portal path (replanRecurringCadence) updates every still-linked package counterpart", async () => {
    const { repo } = seedActivePackage("pkg-1");
    const { packagePlans, recurringPlans } = await seedLinkedCalendar(repo);
    const scheduleId = recurringPlans[0].recurringScheduleId;

    await replanRecurringCadence(repo, {
      recurringScheduleId: scheduleId,
      effectiveFromVisitNumber: 3,
      newCadence: "biweekly",
      newFirstDate: "2026-09-20",
      newFirstStartTime: "13:00",
    });

    for (const visitNumber of [3, 4, 5, 6]) {
      const originalPackagePlan = packagePlans.find((p) => p.visitNumber === visitNumber)!;
      const updatedPackagePlan = await repo.findPackageVisitPlanById(originalPackagePlan.id);
      const updatedRecurringPlan = await repo.findRecurringVisitPlanById(updatedPackagePlan?.recurringVisitPlanId as string);
      expect(updatedRecurringPlan?.plannedDate).toBe(updatedPackagePlan?.plannedDate);
      expect(updatedRecurringPlan?.plannedStartTime).toBe(updatedPackagePlan?.plannedStartTime);
    }
  });

  it("a completed occurrence's plan/history is never touched by a later cadence change on either path", async () => {
    const { repo, state } = seedActivePackage("pkg-1");
    const { packagePlans } = await seedLinkedCalendar(repo);

    const { visitId } = await schedulePackageVisitPlan(repo, {
      packageVisitPlanId: packagePlans[0].id,
      customerId: "customer-1",
      cleaningType: "standard",
      serviceAddressLine1: null,
      serviceAddressLine2: null,
      serviceCity: null,
      serviceState: null,
      serviceAddressIdentity: null,
    });
    await confirmServiceVisit(repo, { serviceVisitId: visitId, date: "2026-08-24", startTime: "10:00", cleanerIds: ["cleaner-1"], durationInput: DURATION_INPUT });
    await completeServiceVisit(repo, visitId);

    await replanPackageCadence(repo, {
      prepaidPackageId: "pkg-1",
      effectiveFromVisitNumber: 1,
      newCadence: "biweekly",
      newFirstDate: "2026-09-20",
      newFirstStartTime: "13:00",
    });

    expect(state.serviceVisitsById.get(visitId)?.confirmedStartAt?.toISOString().slice(0, 10)).toBe("2026-08-24");
    const completedPackagePlan = await repo.findPackageVisitPlanById(packagePlans[0].id);
    expect(completedPackagePlan?.plannedDate).toBe("2026-08-24");
  });
});
