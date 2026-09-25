import { describe, expect, it } from "vitest";
import { assertVisitBelongsToCustomer, CustomerOwnershipError } from "./ownership";
import { createFakeSchedulingRepository } from "@/lib/scheduling/test-support/fake-scheduling-repository";
import type { ServiceVisitRow } from "@/lib/scheduling/domain-types";

function makeVisit(overrides: Partial<ServiceVisitRow> = {}): ServiceVisitRow {
  return {
    id: "visit-1",
    customerId: "customer-a",
    quoteRequestId: null,
    bookingOrderId: null,
    prepaidPackageId: null,
    recurringScheduleId: null,
    visitNumber: null,
    cleaningType: "standard",
    frequency: "one_time",
    status: "completed",
    requestedStartAt: null,
    confirmedAt: null,
    confirmedStartAt: null,
    confirmedEndAt: null,
    estimatedLaborMinutes: null,
    estimatedServiceMinutes: null,
    recommendedCleanerCount: null,
    turnaroundBufferMinutes: null,
    timezone: "America/Chicago",
    workFinishedAt: null,
    completedAt: null,
    cancelledAt: null,
    serviceAddressLine1: null,
    serviceAddressLine2: null,
    serviceCity: null,
    serviceState: null,
    serviceAddressIdentity: null,
    reviewRequestSuppressed: false,
    ...overrides,
  };
}

describe("assertVisitBelongsToCustomer", () => {
  it("returns the visit when it belongs to the requesting customer", async () => {
    const { repo } = createFakeSchedulingRepository({ serviceVisits: [makeVisit()] });
    const visit = await assertVisitBelongsToCustomer(repo, "visit-1", "customer-a");
    expect(visit.id).toBe("visit-1");
  });

  it("throws CustomerOwnershipError for a visit belonging to a different customer", async () => {
    const { repo } = createFakeSchedulingRepository({ serviceVisits: [makeVisit({ customerId: "customer-a" })] });
    await expect(assertVisitBelongsToCustomer(repo, "visit-1", "customer-b")).rejects.toThrow(CustomerOwnershipError);
  });

  it("throws CustomerOwnershipError for a visit id that does not exist at all", async () => {
    const { repo } = createFakeSchedulingRepository({ serviceVisits: [] });
    await expect(assertVisitBelongsToCustomer(repo, "no-such-visit", "customer-a")).rejects.toThrow(CustomerOwnershipError);
  });

  // Regression: the "not found" and "belongs to someone else" cases must be
  // indistinguishable to the caller — same error type, same message — so a
  // customer probing ids can never learn whether a visit exists at all.
  it("gives an identical error for not-found and wrong-owner, so neither leaks which case occurred", async () => {
    const { repo } = createFakeSchedulingRepository({ serviceVisits: [makeVisit({ customerId: "customer-a" })] });

    let wrongOwnerMessage = "";
    try {
      await assertVisitBelongsToCustomer(repo, "visit-1", "customer-b");
    } catch (error) {
      wrongOwnerMessage = (error as Error).message;
    }

    let notFoundMessage = "";
    try {
      await assertVisitBelongsToCustomer(repo, "no-such-visit", "customer-b");
    } catch (error) {
      notFoundMessage = (error as Error).message;
    }

    expect(wrongOwnerMessage).toBe(notFoundMessage);
    expect(wrongOwnerMessage).not.toContain("customer-a");
    expect(wrongOwnerMessage).not.toContain("visit-1");
  });
});
