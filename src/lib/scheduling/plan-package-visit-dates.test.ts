import { describe, expect, it } from "vitest";
import { planPackageVisitDates } from "./plan-package-visit-dates";
import { createFakeSchedulingRepository } from "./test-support/fake-scheduling-repository";

function seedPackage(id: string, purchasedVisitCount = 6) {
  return createFakeSchedulingRepository({
    prepaidPackages: [
      {
        id,
        customerId: "customer-1",
        bookingOrderId: "booking-1",
        frequency: "weekly",
        purchasedVisitCount,
        remainingVisitCount: purchasedVisitCount,
        effectivePricePerVisit: 130,
        status: "active",
        purchasedAt: new Date("2026-01-01T00:00:00Z"),
      },
    ],
  });
}

describe("planPackageVisitDates", () => {
  it("creates exactly purchasedVisitCount planned records", async () => {
    const { repo } = seedPackage("pkg-1");
    const plans = await planPackageVisitDates(repo, {
      prepaidPackageId: "pkg-1",
      customerId: "customer-1",
      cadence: "weekly",
      firstDate: "2026-08-24",
      firstStartTime: "10:00",
    });
    expect(plans.length).toBe(6);
    expect(plans.every((p) => p.status === "planned")).toBe(true);
  });

  it("creates no service_visits rows — plans are not fake operational visits", async () => {
    const { repo, state } = seedPackage("pkg-1");
    await planPackageVisitDates(repo, {
      prepaidPackageId: "pkg-1",
      customerId: "customer-1",
      cadence: "weekly",
      firstDate: "2026-08-24",
      firstStartTime: "10:00",
    });
    expect(state.serviceVisitsById.size).toBe(0);
  });

  it("preserves visit numbering 1..N and correct cadence spacing", async () => {
    const { repo } = seedPackage("pkg-1");
    const plans = await planPackageVisitDates(repo, {
      prepaidPackageId: "pkg-1",
      customerId: "customer-1",
      cadence: "weekly",
      firstDate: "2026-08-24",
      firstStartTime: "10:00",
    });
    expect(plans.map((p) => p.visitNumber)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(plans.map((p) => p.plannedDate)).toEqual([
      "2026-08-24",
      "2026-08-31",
      "2026-09-07",
      "2026-09-14",
      "2026-09-21",
      "2026-09-28",
    ]);
  });

  it("logs initial_plan history for each plan", async () => {
    const { repo, state } = seedPackage("pkg-1");
    await planPackageVisitDates(repo, {
      prepaidPackageId: "pkg-1",
      customerId: "customer-1",
      cadence: "weekly",
      firstDate: "2026-08-24",
      firstStartTime: "10:00",
    });
    expect(state.packageVisitPlanHistory.filter((h) => h.changeReason === "initial_plan").length).toBe(6);
  });

  it("is idempotent — calling twice does not create a second set of plans", async () => {
    const { repo, state } = seedPackage("pkg-1");
    await planPackageVisitDates(repo, { prepaidPackageId: "pkg-1", customerId: "customer-1", cadence: "weekly", firstDate: "2026-08-24", firstStartTime: "10:00" });
    await planPackageVisitDates(repo, { prepaidPackageId: "pkg-1", customerId: "customer-1", cadence: "weekly", firstDate: "2026-08-24", firstStartTime: "10:00" });
    expect(state.packageVisitPlansById.size).toBe(6);
  });
});
