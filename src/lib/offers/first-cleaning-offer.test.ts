import { describe, expect, it } from "vitest";
import {
  LAUNCH_OFFER_ENDS_AT,
  formatCountdown,
  getActiveFirstCleaningOffer,
  getCountdownParts,
} from "@/lib/offers/first-cleaning-offer";

describe("getActiveFirstCleaningOffer", () => {
  it("returns the 30% launch offer well before the deadline", () => {
    const result = getActiveFirstCleaningOffer(new Date("2026-08-15T12:00:00-05:00"));
    expect(result.percent).toBe(30);
    expect(result.offerType).toBe("launch");
    expect(result.isLaunchActive).toBe(true);
    expect(result.showCountdown).toBe(true);
    expect(result.expiresAt).toBe(LAUNCH_OFFER_ENDS_AT.toISOString());
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

  it("returns the 25% standard offer immediately after expiration", () => {
    const justAfter = new Date(LAUNCH_OFFER_ENDS_AT.getTime() + 1);
    const result = getActiveFirstCleaningOffer(justAfter);
    expect(result.percent).toBe(25);
    expect(result.offerType).toBe("standard");
    expect(result.isLaunchActive).toBe(false);
    expect(result.showCountdown).toBe(false);
    expect(result.expiresAt).toBeNull();
  });

  it("returns the 25% standard offer on September 1", () => {
    const result = getActiveFirstCleaningOffer(new Date("2026-09-01T00:00:00-05:00"));
    expect(result.percent).toBe(25);
    expect(result.isLaunchActive).toBe(false);
  });

  it("returns the 25% standard offer for a date far in the future", () => {
    const result = getActiveFirstCleaningOffer(new Date("2027-06-01T00:00:00-05:00"));
    expect(result.percent).toBe(25);
    expect(result.offerType).toBe("standard");
  });

  it("computes the launch deadline as August 31, 2026 11:59:59.999 PM America/Chicago", () => {
    // 2026-08-31 is within CDT (UTC-5), which the zoned-time conversion
    // must derive itself rather than assume.
    expect(LAUNCH_OFFER_ENDS_AT.toISOString()).toBe("2026-09-01T04:59:59.999Z");
  });

  it("exposes distinct offer versions for launch and standard", () => {
    const launch = getActiveFirstCleaningOffer(new Date("2026-08-15T00:00:00-05:00"));
    const standard = getActiveFirstCleaningOffer(new Date("2027-01-01T00:00:00-05:00"));
    expect(launch.offerVersion).not.toBe(standard.offerVersion);
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
