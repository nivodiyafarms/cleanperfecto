import { describe, expect, it } from "vitest";
import type { CalculationInput } from "@/lib/pricing/types";
import { createPackageAmendment } from "./create-package-amendment";
import { createFakeSchedulingRepository } from "./test-support/fake-scheduling-repository";

const BASE_INPUT: CalculationInput = {
  propertyKind: "home",
  cleaningType: "standard",
  condition: "light",
  sizeTier: "2br_2ba",
  zip: "75056",
  frequency: "weekly",
  isPrepaidPackage: true,
  visitCount: 6,
  addOnIds: [],
  firstCleaningEligible: false,
  asOf: new Date("2026-08-22T00:00:00Z"),
};

function seedActivePackage(remainingVisitCount = 4) {
  return createFakeSchedulingRepository({
    prepaidPackages: [
      {
        id: "pkg-1",
        customerId: "customer-1",
        bookingOrderId: "booking-1",
        frequency: "weekly",
        purchasedVisitCount: 6,
        remainingVisitCount,
        effectivePricePerVisit: 100,
        status: "active",
        purchasedAt: new Date("2026-01-01T00:00:00Z"),
      },
    ],
  });
}

describe("createPackageAmendment", () => {
  it("prices only the remaining/unused visit count, not the original 6", async () => {
    const { repo } = seedActivePackage(4);
    const amendment = await createPackageAmendment(repo, {
      prepaidPackageId: "pkg-1",
      newCadence: "every_4_weeks",
      effectiveFromVisitNumber: 3,
      baseInput: BASE_INPUT,
      now: new Date("2026-08-22T00:00:00Z"),
    });
    expect(amendment.remainingVisitCountAtAmendment).toBe(4);
  });

  it("uses the package's actual historical per-visit price for the OLD value, not a re-derived one", async () => {
    const { repo } = seedActivePackage(4);
    const amendment = await createPackageAmendment(repo, {
      prepaidPackageId: "pkg-1",
      newCadence: "every_4_weeks",
      effectiveFromVisitNumber: 3,
      baseInput: BASE_INPUT,
      now: new Date("2026-08-22T00:00:00Z"),
    });
    expect(amendment.oldRemainingValue).toBe(400); // 100 * 4
  });

  it("starts in pending_customer_approval with a computed value difference", async () => {
    const { repo } = seedActivePackage(4);
    const amendment = await createPackageAmendment(repo, {
      prepaidPackageId: "pkg-1",
      newCadence: "weekly", // switching FROM every_4_weeks-priced OLD value TO weekly (more expensive per visit) — expect an increase
      effectiveFromVisitNumber: 3,
      baseInput: BASE_INPUT,
      now: new Date("2026-08-22T00:00:00Z"),
    });
    expect(amendment.approvalState).toBe("pending_customer_approval");
    expect(amendment.valueDifference).toBeCloseTo(amendment.newRemainingValue - amendment.oldRemainingValue, 2);
  });

  it("sets payment_state to additional_payment_pending when the new value is higher", async () => {
    const { repo } = seedActivePackage(4);
    // OLD value is 100/visit * 4 = 400 (a low placeholder); weekly cadence
    // at real pricing will certainly price higher than that per visit.
    const amendment = await createPackageAmendment(repo, {
      prepaidPackageId: "pkg-1",
      newCadence: "weekly",
      effectiveFromVisitNumber: 3,
      baseInput: BASE_INPUT,
      now: new Date("2026-08-22T00:00:00Z"),
    });
    expect(amendment.valueDifference).toBeGreaterThan(0);
    expect(amendment.paymentState).toBe("additional_payment_pending");
  });

  it("rejects amending an inactive package", async () => {
    const { repo, state } = seedActivePackage(4);
    const pkg = state.prepaidPackagesById.get("pkg-1");
    if (pkg) state.prepaidPackagesById.set("pkg-1", { ...pkg, status: "completed" });
    await expect(
      createPackageAmendment(repo, {
        prepaidPackageId: "pkg-1",
        newCadence: "weekly",
        effectiveFromVisitNumber: 3,
        baseInput: BASE_INPUT,
        now: new Date("2026-08-22T00:00:00Z"),
      })
    ).rejects.toThrow();
  });
});
