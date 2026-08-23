import { describe, expect, it } from "vitest";
import { activatePrepaidPackageCalendar } from "./activate-prepaid-package-calendar";
import { InvalidVisitStateError } from "./errors";
import { createFakeSchedulingRepository } from "./test-support/fake-scheduling-repository";

function seedActivePackage(id: string, status: "active" | "completed" | "cancelled" = "active") {
  return createFakeSchedulingRepository({
    prepaidPackages: [
      {
        id,
        customerId: "customer-1",
        bookingOrderId: "booking-1",
        frequency: "weekly",
        purchasedVisitCount: 6,
        remainingVisitCount: 6,
        effectivePricePerVisit: 130,
        status,
        purchasedAt: new Date("2026-01-01T00:00:00Z"),
      },
    ],
  });
}

describe("activatePrepaidPackageCalendar", () => {
  it("creates exactly six package_visit_plans AND six universal recurring_visit_plans from the same cadence/first-date", async () => {
    const { repo, state } = seedActivePackage("pkg-1");

    await activatePrepaidPackageCalendar(repo, {
      prepaidPackageId: "pkg-1",
      customerId: "customer-1",
      cadence: "weekly",
      firstDate: "2026-08-24",
      firstStartTime: "10:00",
    });

    expect(state.packageVisitPlansById.size).toBe(6);
    expect(state.recurringVisitPlansById.size).toBe(6);
  });

  it("creates no fake service_visits", async () => {
    const { repo, state } = seedActivePackage("pkg-1");
    await activatePrepaidPackageCalendar(repo, {
      prepaidPackageId: "pkg-1",
      customerId: "customer-1",
      cadence: "weekly",
      firstDate: "2026-08-24",
      firstStartTime: "10:00",
    });
    expect(state.serviceVisitsById.size).toBe(0);
  });

  it("links each package plan to its universal counterpart by visit_number, with matching dates", async () => {
    const { repo, state } = seedActivePackage("pkg-1");
    await activatePrepaidPackageCalendar(repo, {
      prepaidPackageId: "pkg-1",
      customerId: "customer-1",
      cadence: "weekly",
      firstDate: "2026-08-24",
      firstStartTime: "10:00",
    });

    for (const packagePlan of state.packageVisitPlansById.values()) {
      expect(packagePlan.recurringVisitPlanId).not.toBeNull();
      const linked = state.recurringVisitPlansById.get(packagePlan.recurringVisitPlanId as string);
      expect(linked?.visitNumber).toBe(packagePlan.visitNumber);
      expect(linked?.plannedDate).toBe(packagePlan.plannedDate);
      expect(linked?.plannedStartTime).toBe(packagePlan.plannedStartTime);
    }
  });

  it("is idempotent — calling twice does not duplicate either calendar or re-link", async () => {
    const { repo, state } = seedActivePackage("pkg-1");
    const input = {
      prepaidPackageId: "pkg-1",
      customerId: "customer-1",
      cadence: "weekly" as const,
      firstDate: "2026-08-24",
      firstStartTime: "10:00",
    };
    await activatePrepaidPackageCalendar(repo, input);
    await activatePrepaidPackageCalendar(repo, input);

    expect(state.packageVisitPlansById.size).toBe(6);
    expect(state.recurringVisitPlansById.size).toBe(6);
  });

  it("refuses to activate scheduling for a package that isn't active", async () => {
    const { repo } = seedActivePackage("pkg-1", "cancelled");
    await expect(
      activatePrepaidPackageCalendar(repo, {
        prepaidPackageId: "pkg-1",
        customerId: "customer-1",
        cadence: "weekly",
        firstDate: "2026-08-24",
        firstStartTime: "10:00",
      })
    ).rejects.toThrow(InvalidVisitStateError);
  });
});
