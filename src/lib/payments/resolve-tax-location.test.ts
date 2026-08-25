import { describe, expect, it } from "vitest";
import { InvalidVisitStateError } from "@/lib/scheduling/errors";
import type { ServiceVisitRow } from "@/lib/scheduling/domain-types";
import { resolveTaxLocationAddress } from "./resolve-tax-location";

function baseVisit(overrides: Partial<ServiceVisitRow> = {}): ServiceVisitRow {
  return {
    id: "visit-1",
    customerId: "customer-1",
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
    completedAt: new Date(),
    cancelledAt: null,
    serviceAddressLine1: "123 Main St",
    serviceAddressLine2: null,
    serviceCity: "Frisco",
    serviceState: "TX",
    serviceAddressIdentity: "75056|123 MAIN ST|",
    reviewRequestSuppressed: false,
    ...overrides,
  };
}

describe("resolveTaxLocationAddress", () => {
  it("extracts the ZIP5 from the leading segment of service_address_identity — never from the customer's profile/billing address", () => {
    const address = resolveTaxLocationAddress(baseVisit());
    expect(address.zip).toBe("75056");
    expect(address.line1).toBe("123 Main St");
    expect(address.city).toBe("Frisco");
    expect(address.state).toBe("TX");
  });

  it("throws when service_address_identity is null — never silently guesses a location", () => {
    expect(() => resolveTaxLocationAddress(baseVisit({ serviceAddressIdentity: null }))).toThrow(InvalidVisitStateError);
  });

  it("throws when the leading segment isn't a valid 5-digit ZIP", () => {
    expect(() => resolveTaxLocationAddress(baseVisit({ serviceAddressIdentity: "BADZIP|123 MAIN ST|" }))).toThrow(InvalidVisitStateError);
  });
});
