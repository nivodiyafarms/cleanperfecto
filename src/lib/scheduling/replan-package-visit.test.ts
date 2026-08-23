import { describe, expect, it } from "vitest";
import { planPackageVisitDates } from "./plan-package-visit-dates";
import { replanPackageVisit } from "./replan-package-visit";
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

describe("replanPackageVisit", () => {
  it("moves only the targeted visit — other visits stay unchanged", async () => {
    const { repo, state } = seedPlannedPackage();
    const plans = await planPackageVisitDates(repo, { prepaidPackageId: "pkg-1", customerId: "customer-1", cadence: "weekly", firstDate: "2026-08-24", firstStartTime: "10:00" });

    const visit3 = plans[2];
    await replanPackageVisit(repo, { packageVisitPlanId: visit3.id, newPlannedDate: "2026-09-20", newPlannedStartTime: "14:00" });

    const updated = state.packageVisitPlansById.get(visit3.id);
    expect(updated?.plannedDate).toBe("2026-09-20");
    expect(updated?.plannedStartTime).toBe("14:00");

    const others = plans.filter((p) => p.id !== visit3.id);
    for (const other of others) {
      expect(state.packageVisitPlansById.get(other.id)?.plannedDate).toBe(other.plannedDate);
    }
  });

  it("logs manual_single_move history", async () => {
    const { repo, state } = seedPlannedPackage();
    const plans = await planPackageVisitDates(repo, { prepaidPackageId: "pkg-1", customerId: "customer-1", cadence: "weekly", firstDate: "2026-08-24", firstStartTime: "10:00" });
    await replanPackageVisit(repo, { packageVisitPlanId: plans[2].id, newPlannedDate: "2026-09-20", newPlannedStartTime: "14:00" });
    expect(state.packageVisitPlanHistory.some((h) => h.changeReason === "manual_single_move")).toBe(true);
  });

  it("rejects moving a plan that's already linked to a real visit", async () => {
    const { repo } = seedPlannedPackage();
    const plans = await planPackageVisitDates(repo, { prepaidPackageId: "pkg-1", customerId: "customer-1", cadence: "weekly", firstDate: "2026-08-24", firstStartTime: "10:00" });
    await schedulePackageVisitPlan(repo, {
      packageVisitPlanId: plans[0].id,
      customerId: "customer-1",
      cleaningType: "standard",
      serviceAddressLine1: null,
      serviceAddressLine2: null,
      serviceCity: null,
      serviceState: null,
      serviceAddressIdentity: null,
    });
    await expect(
      replanPackageVisit(repo, { packageVisitPlanId: plans[0].id, newPlannedDate: "2026-09-01", newPlannedStartTime: "10:00" })
    ).rejects.toThrow();
  });
});
