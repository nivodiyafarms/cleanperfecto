import { describe, expect, it } from "vitest";
import { planPackageVisitDates } from "./plan-package-visit-dates";
import { schedulePackageVisitPlan } from "./schedule-package-visit-plan";
import { createFakeSchedulingRepository } from "./test-support/fake-scheduling-repository";

function seedPlannedPackage() {
  return createFakeSchedulingRepository({
    prepaidPackages: [
      {
        id: "pkg-1",
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

describe("schedulePackageVisitPlan", () => {
  it("creates a real 'requested' service_visits row linked to the plan", async () => {
    const { repo, state } = seedPlannedPackage();
    const plans = await planPackageVisitDates(repo, { prepaidPackageId: "pkg-1", customerId: "customer-1", cadence: "weekly", firstDate: "2026-08-24", firstStartTime: "10:00" });

    const { visitId } = await schedulePackageVisitPlan(repo, {
      packageVisitPlanId: plans[0].id,
      customerId: "customer-1",
      cleaningType: "standard",
      serviceAddressLine1: null,
      serviceAddressLine2: null,
      serviceCity: null,
      serviceState: null,
      serviceAddressIdentity: null,
    });

    const visit = state.serviceVisitsById.get(visitId);
    expect(visit?.status).toBe("requested");
    expect(visit?.prepaidPackageId).toBe("pkg-1");
    expect(visit?.visitNumber).toBe(1);

    const plan = state.packageVisitPlansById.get(plans[0].id);
    expect(plan?.status).toBe("linked");
    expect(plan?.serviceVisitId).toBe(visitId);
  });

  it("does not mark the plan or its future package visits as completed just by linking", async () => {
    const { repo, state } = seedPlannedPackage();
    const plans = await planPackageVisitDates(repo, { prepaidPackageId: "pkg-1", customerId: "customer-1", cadence: "weekly", firstDate: "2026-08-24", firstStartTime: "10:00" });
    const { visitId } = await schedulePackageVisitPlan(repo, {
      packageVisitPlanId: plans[0].id,
      customerId: "customer-1",
      cleaningType: "standard",
      serviceAddressLine1: null,
      serviceAddressLine2: null,
      serviceCity: null,
      serviceState: null,
      serviceAddressIdentity: null,
    });
    expect(state.serviceVisitsById.get(visitId)?.status).not.toBe("completed");
    expect(state.prepaidPackagesById.get("pkg-1")?.remainingVisitCount).toBe(6);
  });

  it("is idempotent — a second call for an already-linked plan returns the same visit", async () => {
    const { repo } = seedPlannedPackage();
    const plans = await planPackageVisitDates(repo, { prepaidPackageId: "pkg-1", customerId: "customer-1", cadence: "weekly", firstDate: "2026-08-24", firstStartTime: "10:00" });
    const input = {
      packageVisitPlanId: plans[0].id,
      customerId: "customer-1",
      cleaningType: "standard" as const,
      serviceAddressLine1: null,
      serviceAddressLine2: null,
      serviceCity: null,
      serviceState: null,
      serviceAddressIdentity: null,
    };
    const first = await schedulePackageVisitPlan(repo, input);
    const second = await schedulePackageVisitPlan(repo, input);
    expect(second.visitId).toBe(first.visitId);
    expect(second.alreadyLinked).toBe(true);
  });
});
