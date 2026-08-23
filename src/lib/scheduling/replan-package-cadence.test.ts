import { describe, expect, it } from "vitest";
import { planPackageVisitDates } from "./plan-package-visit-dates";
import { replanPackageCadence } from "./replan-package-cadence";
import { schedulePackageVisitPlan } from "./schedule-package-visit-plan";
import { completeServiceVisit } from "./complete-service-visit";
import { confirmServiceVisit } from "./confirm-service-visit";
import { createFakeSchedulingRepository } from "./test-support/fake-scheduling-repository";

const DURATION_INPUT = { cleaningType: "standard" as const, sizeTier: "2br_2ba" as const, condition: "light" as const };

function seedPlannedPackage() {
  return createFakeSchedulingRepository({
    cleaners: [{ id: "cleaner-1", name: "A", active: true }],
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
      },
    ],
  });
}

describe("replanPackageCadence", () => {
  it("regenerates remaining still-planned visits starting at the effective visit number, using the new cadence", async () => {
    const { repo } = seedPlannedPackage();
    await planPackageVisitDates(repo, { prepaidPackageId: "pkg-1", customerId: "customer-1", cadence: "weekly", firstDate: "2026-08-24", firstStartTime: "10:00" });

    const updated = await replanPackageCadence(repo, {
      prepaidPackageId: "pkg-1",
      effectiveFromVisitNumber: 3,
      newCadence: "biweekly",
      newFirstDate: "2026-09-20",
      newFirstStartTime: "13:00",
    });

    expect(updated.map((p) => p.visitNumber)).toEqual([3, 4, 5, 6]);
    expect(updated.map((p) => p.plannedDate)).toEqual(["2026-09-20", "2026-10-04", "2026-10-18", "2026-11-01"]);

    // Visits 1-2 are untouched.
    const all = await repo.listPackageVisitPlans("pkg-1");
    const visit1 = all.find((p) => p.visitNumber === 1);
    expect(visit1?.plannedDate).toBe("2026-08-24");
  });

  it("never regenerates an already-linked (real) visit — that visit's own reschedule path applies instead", async () => {
    const { repo, state } = seedPlannedPackage();
    const plans = await planPackageVisitDates(repo, { prepaidPackageId: "pkg-1", customerId: "customer-1", cadence: "weekly", firstDate: "2026-08-24", firstStartTime: "10:00" });

    // Link + confirm + complete visit #1 — it must never be touched by a
    // later cadence regeneration.
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
    await confirmServiceVisit(repo, { serviceVisitId: visitId, date: "2026-08-24", startTime: "10:00", cleanerIds: ["cleaner-1"], durationInput: DURATION_INPUT });
    await completeServiceVisit(repo, visitId);

    await replanPackageCadence(repo, {
      prepaidPackageId: "pkg-1",
      effectiveFromVisitNumber: 1,
      newCadence: "biweekly",
      newFirstDate: "2026-09-20",
      newFirstStartTime: "13:00",
    });

    // The completed visit's own confirmed date must be untouched.
    expect(state.serviceVisitsById.get(visitId)?.confirmedStartAt?.toISOString().slice(0, 10)).toBe("2026-08-24");
    // And the linked plan's planned_date must be untouched too (it's no
    // longer eligible for regeneration).
    expect(state.packageVisitPlansById.get(plans[0].id)?.plannedDate).toBe("2026-08-24");
  });

  it("logs cadence_regeneration history for each regenerated plan", async () => {
    const { repo, state } = seedPlannedPackage();
    await planPackageVisitDates(repo, { prepaidPackageId: "pkg-1", customerId: "customer-1", cadence: "weekly", firstDate: "2026-08-24", firstStartTime: "10:00" });
    await replanPackageCadence(repo, { prepaidPackageId: "pkg-1", effectiveFromVisitNumber: 1, newCadence: "biweekly", newFirstDate: "2026-09-20", newFirstStartTime: "13:00" });
    expect(state.packageVisitPlanHistory.filter((h) => h.changeReason === "cadence_regeneration").length).toBe(6);
  });
});
