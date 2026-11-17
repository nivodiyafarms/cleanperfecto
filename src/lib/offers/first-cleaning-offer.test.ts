import { describe, expect, it } from "vitest";
import {
  LAUNCH_OFFER_ENDS_AT,
  OFFER_SWITCH_AT,
  formatCountdown,
  getActiveFirstCleaningOffer,
  getCountdownParts,
  isServiceEligibleForFirstCleaningOffer,
} from "@/lib/offers/first-cleaning-offer";

describe("getActiveFirstCleaningOffer", () => {
  it("returns the 30% launch offer well before the deadline", () => {
    const result = getActiveFirstCleaningOffer(new Date("2026-08-15T12:00:00-05:00"));
    expect(result.percent).toBe(30);
    expect(result.offerType).toBe("launch");
    expect(result.isLaunchActive).toBe(true);
    expect(result.showCountdown).toBe(true);
    expect(result.expiresAt).toBe(LAUNCH_OFFER_ENDS_AT.toISOString());
    expect(result.eligibleServices).toBe("all");
  });

  it("returns the 30% launch offer during the day of August 31", () => {
    const result = getActiveFirstCleaningOffer(new Date("2026-08-31T12:00:00-05:00"));
    expect(result.percent).toBe(30);
    expect(result.isLaunchActive).toBe(true);
  });

  it("returns the 30% launch offer at the last second before expiration", () => {
    const result = getActiveFirstCleaningOffer(new Date("2026-08-31T23:59:59.000-05:00"));
    expect(result.percent).toBe(30);
    expect(result.isLaunchActive).toBe(true);
  });

  it("returns the 30% launch offer at the exact deadline instant", () => {
    const result = getActiveFirstCleaningOffer(LAUNCH_OFFER_ENDS_AT);
    expect(result.percent).toBe(30);
    expect(result.isLaunchActive).toBe(true);
  });

  it("returns the 25% standard offer immediately after launch expiration", () => {
    const justAfter = new Date(LAUNCH_OFFER_ENDS_AT.getTime() + 1);
    const result = getActiveFirstCleaningOffer(justAfter);
    expect(result.percent).toBe(25);
    expect(result.offerType).toBe("standard");
    expect(result.isLaunchActive).toBe(false);
    expect(result.showCountdown).toBe(true);
    expect(result.expiresAt).toBe(OFFER_SWITCH_AT.toISOString());
    expect(result.eligibleServices).toBe("all");
  });

  it("returns the 25% standard offer on September 1", () => {
    const result = getActiveFirstCleaningOffer(new Date("2026-09-01T00:00:00-05:00"));
    expect(result.percent).toBe(25);
    expect(result.isLaunchActive).toBe(false);
    expect(result.eligibleServices).toBe("all");
  });

  it("returns the 25% standard offer on November 30 during the day", () => {
    const result = getActiveFirstCleaningOffer(new Date("2026-11-30T12:00:00-06:00"));
    expect(result.percent).toBe(25);
    expect(result.offerType).toBe("standard");
    expect(result.showCountdown).toBe(true);
    expect(result.eligibleServices).toBe("all");
  });

  it("returns the 25% standard offer one second before the Dec 1 cutoff", () => {
    const justBefore = new Date(OFFER_SWITCH_AT.getTime() - 1);
    const result = getActiveFirstCleaningOffer(justBefore);
    expect(result.percent).toBe(25);
    expect(result.offerType).toBe("standard");
    expect(result.eligibleServices).toBe("all");
  });

  it("returns the 20% deep-only offer at exactly the Dec 1 cutoff", () => {
    const result = getActiveFirstCleaningOffer(OFFER_SWITCH_AT);
    expect(result.percent).toBe(20);
    expect(result.offerType).toBe("deep_only");
    expect(result.isLaunchActive).toBe(false);
    expect(result.showCountdown).toBe(false);
    expect(result.expiresAt).toBeNull();
    expect(result.eligibleServices).toBe("deep_only");
  });

  it("returns the 20% deep-only offer immediately after the Dec 1 cutoff", () => {
    const justAfter = new Date(OFFER_SWITCH_AT.getTime() + 1);
    const result = getActiveFirstCleaningOffer(justAfter);
    expect(result.percent).toBe(20);
    expect(result.offerType).toBe("deep_only");
    expect(result.eligibleServices).toBe("deep_only");
  });

  it("returns the 20% deep-only offer for a date far in the future", () => {
    const result = getActiveFirstCleaningOffer(new Date("2027-06-01T00:00:00-05:00"));
    expect(result.percent).toBe(20);
    expect(result.offerType).toBe("deep_only");
    expect(result.eligibleServices).toBe("deep_only");
  });

  it("computes the launch deadline as August 31, 2026 11:59:59.999 PM America/Chicago", () => {
    // 2026-08-31 is within CDT (UTC-5), which the zoned-time conversion
    // must derive itself rather than assume.
    expect(LAUNCH_OFFER_ENDS_AT.toISOString()).toBe("2026-09-01T04:59:59.999Z");
  });

  it("computes the OFFER_SWITCH_AT as December 1, 2026 00:00:00 AM America/Chicago (CST, UTC-6)", () => {
    // December 1, 2026 is within CST (UTC-6), so midnight local = 06:00 UTC.
    expect(OFFER_SWITCH_AT.toISOString()).toBe("2026-12-01T06:00:00.000Z");
  });

  it("exposes distinct offer versions for launch, standard, and deep_only", () => {
    const launch = getActiveFirstCleaningOffer(new Date("2026-08-15T00:00:00-05:00"));
    const standard = getActiveFirstCleaningOffer(new Date("2026-10-15T00:00:00-05:00"));
    const deepOnly = getActiveFirstCleaningOffer(new Date("2027-01-01T00:00:00-06:00"));
    expect(launch.offerVersion).not.toBe(standard.offerVersion);
    expect(standard.offerVersion).not.toBe(deepOnly.offerVersion);
    expect(launch.offerVersion).not.toBe(deepOnly.offerVersion);
  });
});

describe("isServiceEligibleForFirstCleaningOffer", () => {
  it("returns true for all cleaning types during the standard offer period", () => {
    const during = new Date("2026-10-15T12:00:00-05:00");
    expect(isServiceEligibleForFirstCleaningOffer(during, "standard")).toBe(true);
    expect(isServiceEligibleForFirstCleaningOffer(during, "deep")).toBe(true);
    expect(isServiceEligibleForFirstCleaningOffer(during, "move")).toBe(true);
  });

  it("returns true for all cleaning types during the launch offer period", () => {
    const during = new Date("2026-08-15T12:00:00-05:00");
    expect(isServiceEligibleForFirstCleaningOffer(during, "standard")).toBe(true);
    expect(isServiceEligibleForFirstCleaningOffer(during, "deep")).toBe(true);
    expect(isServiceEligibleForFirstCleaningOffer(during, "move")).toBe(true);
  });

  it("returns true only for deep cleaning after the Dec 1 cutoff", () => {
    const after = new Date("2026-12-15T12:00:00-06:00");
    expect(isServiceEligibleForFirstCleaningOffer(after, "standard")).toBe(false);
    expect(isServiceEligibleForFirstCleaningOffer(after, "deep")).toBe(true);
    expect(isServiceEligibleForFirstCleaningOffer(after, "move")).toBe(false);
  });

  it("returns true only for deep cleaning exactly at the Dec 1 cutoff", () => {
    expect(isServiceEligibleForFirstCleaningOffer(OFFER_SWITCH_AT, "standard")).toBe(false);
    expect(isServiceEligibleForFirstCleaningOffer(OFFER_SWITCH_AT, "deep")).toBe(true);
    expect(isServiceEligibleForFirstCleaningOffer(OFFER_SWITCH_AT, "move")).toBe(false);
  });
});

describe("getCountdownParts / formatCountdown", () => {
  it("computes days/hours/minutes/seconds remaining and formats them", () => {
    const now = new Date("2026-08-11T00:00:00-05:00");
    const expiresAt = new Date("2026-08-31T02:14:32-05:00").toISOString();

    const parts = getCountdownParts(now, expiresAt);

    expect(parts).toEqual({ days: 20, hours: 2, minutes: 14, seconds: 32 });
    expect(formatCountdown(parts)).toBe("20d 02h 14m 32s remaining");
  });

  it("reaches zero and does not go negative once the deadline has passed", () => {
    const now = new Date("2026-09-05T00:00:00-05:00");

    const parts = getCountdownParts(now, LAUNCH_OFFER_ENDS_AT.toISOString());

    expect(parts).toEqual({ days: 0, hours: 0, minutes: 0, seconds: 0 });
    expect(formatCountdown(parts)).toBe("0d 00h 00m 00s remaining");
  });

  it("counts down to exactly zero at the deadline instant itself", () => {
    const parts = getCountdownParts(LAUNCH_OFFER_ENDS_AT, LAUNCH_OFFER_ENDS_AT.toISOString());
    expect(parts).toEqual({ days: 0, hours: 0, minutes: 0, seconds: 0 });
  });
});
