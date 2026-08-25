import { describe, expect, it } from "vitest";
import { computeReviewRequestSendAt } from "./review-timing";

describe("computeReviewRequestSendAt", () => {
  it("defaults to completed_at + 3 hours when that lands before ~8pm local", () => {
    // 10:00 AM America/Chicago (CDT, UTC-5) -> +3h = 1:00 PM local, well before 8pm.
    const completedAtUtc = new Date("2026-09-10T15:00:00.000Z"); // 10:00 AM CDT
    const result = computeReviewRequestSendAt(completedAtUtc, "America/Chicago");
    expect(result.toISOString()).toBe("2026-09-10T18:00:00.000Z"); // 1:00 PM CDT
  });

  it("defers to ~10:00 AM the next local day when +3h lands at/after ~8pm local", () => {
    // 6:00 PM America/Chicago (CDT) -> +3h = 9:00 PM local, past the 8pm cutoff.
    const completedAtUtc = new Date("2026-09-10T23:00:00.000Z"); // 6:00 PM CDT
    const result = computeReviewRequestSendAt(completedAtUtc, "America/Chicago");
    // Expect 10:00 AM CDT the FOLLOWING day (2026-09-11) = 15:00 UTC.
    expect(result.toISOString()).toBe("2026-09-11T15:00:00.000Z");
  });

  it("never hardcodes America/Chicago — the same instant resolves differently in a different timezone", () => {
    const completedAtUtc = new Date("2026-09-10T23:00:00.000Z");
    const chicagoResult = computeReviewRequestSendAt(completedAtUtc, "America/Chicago");
    const laResult = computeReviewRequestSendAt(completedAtUtc, "America/Los_Angeles");
    expect(chicagoResult.toISOString()).not.toBe(laResult.toISOString());
  });

  it("stays on the same-day +3h path right at the boundary (just under 8pm)", () => {
    // 4:30 PM CDT -> +3h = 7:30 PM CDT, still before the 8pm cutoff.
    const completedAtUtc = new Date("2026-09-10T21:30:00.000Z");
    const result = computeReviewRequestSendAt(completedAtUtc, "America/Chicago");
    expect(result.toISOString()).toBe("2026-09-11T00:30:00.000Z"); // 7:30 PM CDT same day
  });
});
