import { describe, expect, it } from "vitest";
import { assessFee, CANCELLATION_FEE_SCHEDULE } from "./assess-cancellation-fee";

const CONFIRMED_START = new Date("2026-08-30T14:00:00.000Z");

describe("assessFee", () => {
  it("charges nothing 48+ hours before the confirmed start", () => {
    const now = new Date(CONFIRMED_START.getTime() - 48 * 60 * 60 * 1000);
    expect(assessFee("cancellation", now, CONFIRMED_START).amount).toBe(0);
  });

  it("charges the late-change fee for 24-48 hours notice", () => {
    const now = new Date(CONFIRMED_START.getTime() - 30 * 60 * 60 * 1000);
    expect(assessFee("reschedule", now, CONFIRMED_START).amount).toBe(CANCELLATION_FEE_SCHEDULE.lateChangeFee);
  });

  it("charges the same-day fee for under 24 hours notice", () => {
    const now = new Date(CONFIRMED_START.getTime() - 5 * 60 * 60 * 1000);
    expect(assessFee("cancellation", now, CONFIRMED_START).amount).toBe(CANCELLATION_FEE_SCHEDULE.sameDayFee);
  });

  it("always charges the dispatched/no-access fee regardless of notice", () => {
    const now = new Date(CONFIRMED_START.getTime() - 200 * 60 * 60 * 1000);
    expect(assessFee("no_access", now, CONFIRMED_START).amount).toBe(CANCELLATION_FEE_SCHEDULE.dispatchedNoAccessFee);
  });

  it("stamps the current CANCELLATION_POLICY_VERSION on every assessment", () => {
    const result = assessFee("cancellation", new Date(CONFIRMED_START.getTime() - 60 * 60 * 1000), CONFIRMED_START);
    expect(result.policyVersion).toBeTruthy();
  });
});
