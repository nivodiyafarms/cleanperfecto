import { describe, expect, it } from "vitest";
import { buildServiceAddressIdentity } from "./normalize-address";
import type { CompletedServiceHistoryRepository } from "./eligibility-repository";
import { checkFirstCleaningEligibility } from "./first-cleaning-eligibility";

interface FakeVisit {
  emailNormalized: string | null;
  phoneNormalized: string | null;
  serviceAddressIdentity: string | null;
  status: "scheduled" | "completed" | "cancelled";
}

class FakeServiceHistoryRepository implements CompletedServiceHistoryRepository {
  constructor(private visits: FakeVisit[]) {}

  async hasCompletedVisitByEmail(emailNormalized: string): Promise<boolean> {
    return this.visits.some((v) => v.status === "completed" && v.emailNormalized === emailNormalized);
  }

  async hasCompletedVisitByPhone(phoneNormalized: string): Promise<boolean> {
    return this.visits.some((v) => v.status === "completed" && v.phoneNormalized === phoneNormalized);
  }

  async hasCompletedVisitByAddress(serviceAddressIdentity: string): Promise<boolean> {
    return this.visits.some(
      (v) => v.status === "completed" && v.serviceAddressIdentity === serviceAddressIdentity
    );
  }
}

const ADDRESS_UNIT_4B = buildServiceAddressIdentity({ zip: "75056", line1: "123 Main St", line2: "Apt 4B" })!;
const ADDRESS_UNIT_4C = buildServiceAddressIdentity({ zip: "75056", line1: "123 Main St", line2: "Apt 4C" })!;

describe("checkFirstCleaningEligibility", () => {
  it("is eligible when there is no service history at all", async () => {
    const repo = new FakeServiceHistoryRepository([]);
    const result = await checkFirstCleaningEligibility(
      { emailNormalized: "jane@example.com", phoneNormalized: "+14695550100", serviceAddressIdentity: ADDRESS_UNIT_4B },
      repo
    );
    expect(result).toEqual({ eligible: true });
  });

  it("a completed visit matching normalized email makes the customer ineligible", async () => {
    const repo = new FakeServiceHistoryRepository([
      { emailNormalized: "jane@example.com", phoneNormalized: null, serviceAddressIdentity: null, status: "completed" },
    ]);
    const result = await checkFirstCleaningEligibility(
      { emailNormalized: "jane@example.com", phoneNormalized: null, serviceAddressIdentity: null },
      repo
    );
    expect(result).toEqual({ eligible: false, matchedBy: ["email"] });
  });

  it("a completed visit matching normalized phone makes the customer ineligible", async () => {
    const repo = new FakeServiceHistoryRepository([
      { emailNormalized: null, phoneNormalized: "+14695550100", serviceAddressIdentity: null, status: "completed" },
    ]);
    const result = await checkFirstCleaningEligibility(
      { emailNormalized: null, phoneNormalized: "+14695550100", serviceAddressIdentity: null },
      repo
    );
    expect(result).toEqual({ eligible: false, matchedBy: ["phone"] });
  });

  it("a completed visit matching the service address (including unit) makes the customer ineligible", async () => {
    const repo = new FakeServiceHistoryRepository([
      { emailNormalized: null, phoneNormalized: null, serviceAddressIdentity: ADDRESS_UNIT_4B, status: "completed" },
    ]);
    const result = await checkFirstCleaningEligibility(
      { emailNormalized: null, phoneNormalized: null, serviceAddressIdentity: ADDRESS_UNIT_4B },
      repo
    );
    expect(result).toEqual({ eligible: false, matchedBy: ["address"] });
  });

  it("the same street but a different apartment unit does not match", async () => {
    const repo = new FakeServiceHistoryRepository([
      { emailNormalized: null, phoneNormalized: null, serviceAddressIdentity: ADDRESS_UNIT_4B, status: "completed" },
    ]);
    const result = await checkFirstCleaningEligibility(
      { emailNormalized: null, phoneNormalized: null, serviceAddressIdentity: ADDRESS_UNIT_4C },
      repo
    );
    expect(result).toEqual({ eligible: true });
  });

  it("a scheduled-only visit does not affect eligibility", async () => {
    const repo = new FakeServiceHistoryRepository([
      { emailNormalized: "jane@example.com", phoneNormalized: null, serviceAddressIdentity: null, status: "scheduled" },
    ]);
    const result = await checkFirstCleaningEligibility(
      { emailNormalized: "jane@example.com", phoneNormalized: null, serviceAddressIdentity: null },
      repo
    );
    expect(result).toEqual({ eligible: true });
  });

  it("a cancelled-only visit does not affect eligibility", async () => {
    const repo = new FakeServiceHistoryRepository([
      { emailNormalized: "jane@example.com", phoneNormalized: null, serviceAddressIdentity: null, status: "cancelled" },
    ]);
    const result = await checkFirstCleaningEligibility(
      { emailNormalized: "jane@example.com", phoneNormalized: null, serviceAddressIdentity: null },
      repo
    );
    expect(result).toEqual({ eligible: true });
  });

  it("reports every matching identifier, not just the first", async () => {
    const repo = new FakeServiceHistoryRepository([
      { emailNormalized: "jane@example.com", phoneNormalized: "+14695550100", serviceAddressIdentity: ADDRESS_UNIT_4B, status: "completed" },
    ]);
    const result = await checkFirstCleaningEligibility(
      { emailNormalized: "jane@example.com", phoneNormalized: "+14695550100", serviceAddressIdentity: ADDRESS_UNIT_4B },
      repo
    );
    expect(result).toEqual({ eligible: false, matchedBy: ["email", "phone", "address"] });
  });

  it("never queries by quote_request_id or quote history — a prior inquiry/quote alone cannot disqualify, by construction (the repository interface has no such method)", async () => {
    const repo = new FakeServiceHistoryRepository([]);
    const result = await checkFirstCleaningEligibility(
      { emailNormalized: "returning-inquirer@example.com", phoneNormalized: null, serviceAddressIdentity: null },
      repo
    );
    expect(result).toEqual({ eligible: true });
  });
});
