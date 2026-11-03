import { describe, expect, it, vi } from "vitest";
import { checkReferralCodeStatus } from "./check-referral-code-status";
import { runCheckReferralCode } from "./run-check-referral-code";
import { createReferralCodeCheckTracker, messageForReferralCodeStatus } from "./referral-code-feedback";
import {
  REFERRAL_CODE_APPLIED_MESSAGE,
  REFERRAL_CODE_CHECK_FAILED_MESSAGE,
  REFERRAL_CODE_INACTIVE_MESSAGE,
  referralCodeRateLimitedMessage,
} from "./copy";
import {
  REFERRAL_CODE_CHECK_HOUR_LIMIT,
  REFERRAL_CODE_CHECK_MINUTE_LIMIT,
} from "./referral-code-check-rate-limit";
import { createFixedWindowRateLimitStore } from "@/lib/security/fixed-window-rate-limit-store";
import { createTakeReferralCodeCheckRateLimit } from "./referral-code-check-rate-limit";
import { RATE_LIMIT_HMAC_SECRET_MIN_LENGTH } from "@/lib/security/rate-limit-hmac-secret";
import { buildReferralCheckRateLimitKey } from "@/lib/security/rate-limit-key";

/** Fixture Type A (customer) and Type B (admin_issued) codes — status mapping must treat them identically. */
const TYPE_A_ACTIVE = "H37RH6TN";
const TYPE_B_ACTIVE = "94EK5RB9";
const DISABLED_CODE = "ABCD2345";
const MISSING_CODE = "ZZZZ2345";
const SECRET = "s".repeat(RATE_LIMIT_HMAC_SECRET_MIN_LENGTH);

describe("checkReferralCodeStatus", () => {
  it("returns valid for an active Type A (customer) code without leaking type or owner fields", async () => {
    const lookup = vi.fn(async () => "active" as const);
    const result = await checkReferralCodeStatus(TYPE_A_ACTIVE, { lookupByNormalizedCode: lookup });
    expect(result).toEqual({ status: "valid" });
    expect(Object.keys(result)).toEqual(["status"]);
    expect(lookup).toHaveBeenCalledWith(TYPE_A_ACTIVE);
  });

  it("returns valid for an active Type B (admin_issued) code without leaking recipient label fields", async () => {
    const lookup = vi.fn(async () => "active" as const);
    const result = await checkReferralCodeStatus(TYPE_B_ACTIVE.toLowerCase(), {
      lookupByNormalizedCode: lookup,
    });
    expect(result).toEqual({ status: "valid" });
    expect(JSON.stringify(result)).not.toMatch(/admin|customer|recipient|label|owner|given/i);
    expect(lookup).toHaveBeenCalledWith(TYPE_B_ACTIVE);
  });

  it("maps disabled and missing codes to inactive (same customer-facing status)", async () => {
    await expect(
      checkReferralCodeStatus(DISABLED_CODE, {
        lookupByNormalizedCode: async () => "inactive",
      })
    ).resolves.toEqual({ status: "inactive" });

    await expect(
      checkReferralCodeStatus(MISSING_CODE, {
        lookupByNormalizedCode: async () => "missing",
      })
    ).resolves.toEqual({ status: "inactive" });
  });

  it("maps malformed codes to inactive without calling lookup", async () => {
    const lookup = vi.fn(async () => "active" as const);
    await expect(checkReferralCodeStatus("nope", { lookupByNormalizedCode: lookup })).resolves.toEqual({
      status: "inactive",
    });
    expect(lookup).not.toHaveBeenCalled();
  });

  it("maps lookup failures and thrown errors to error — never inactive", async () => {
    await expect(
      checkReferralCodeStatus(TYPE_A_ACTIVE, {
        lookupByNormalizedCode: async () => "error",
      })
    ).resolves.toEqual({ status: "error" });

    await expect(
      checkReferralCodeStatus(TYPE_A_ACTIVE, {
        lookupByNormalizedCode: async () => {
          throw new Error("db down");
        },
      })
    ).resolves.toEqual({ status: "error" });
  });
});

describe("runCheckReferralCode rate limiting and response shape", () => {
  it("returns rate_limited (not inactive) when the shared IP rate limit is exceeded", async () => {
    const store = createFixedWindowRateLimitStore();
    const now = 1_700_000_200_000;
    const takeRateLimit = createTakeReferralCodeCheckRateLimit({
      readSecret: () => SECRET,
      consume: async ({ key, minuteLimit, hourLimit }) => {
        const result = store.consume(key, minuteLimit, hourLimit, now);
        return result.allowed
          ? { ok: true, allowed: true, retry_after_seconds: 0 }
          : { ok: true, allowed: false, retry_after_seconds: result.retry_after_seconds };
      },
    });
    const lookup = vi.fn(async () => "active" as const);
    const deps = {
      getClientIp: async () => "203.0.113.10",
      takeRateLimit,
      lookupByNormalizedCode: lookup,
    };

    for (let i = 0; i < REFERRAL_CODE_CHECK_MINUTE_LIMIT; i += 1) {
      await expect(runCheckReferralCode(TYPE_A_ACTIVE, deps)).resolves.toEqual({ status: "valid" });
    }
    const limited = await runCheckReferralCode(TYPE_A_ACTIVE, deps);
    expect(limited.status).toBe("rate_limited");
    if (limited.status === "rate_limited") {
      expect(limited.retry_after_seconds).toBeGreaterThan(0);
    }
    expect(lookup).toHaveBeenCalledTimes(REFERRAL_CODE_CHECK_MINUTE_LIMIT);
  });

  it("returns error and skips lookup when the client IP is unavailable", async () => {
    const lookup = vi.fn(async () => "active" as const);
    const takeRateLimit = vi.fn(async () => ({ outcome: "allowed" as const }));
    await expect(
      runCheckReferralCode(TYPE_A_ACTIVE, {
        getClientIp: async () => null,
        takeRateLimit,
        lookupByNormalizedCode: lookup,
      })
    ).resolves.toEqual({ status: "error" });
    expect(takeRateLimit).not.toHaveBeenCalled();
    expect(lookup).not.toHaveBeenCalled();
  });

  it("returns error and skips lookup when the limiter fails closed", async () => {
    const lookup = vi.fn(async () => "active" as const);
    await expect(
      runCheckReferralCode(TYPE_A_ACTIVE, {
        getClientIp: async () => "203.0.113.10",
        takeRateLimit: async () => ({ outcome: "error" }),
        lookupByNormalizedCode: lookup,
      })
    ).resolves.toEqual({ status: "error" });
    expect(lookup).not.toHaveBeenCalled();
  });

  it("uses the configured public minute/hour limits", () => {
    expect(REFERRAL_CODE_CHECK_MINUTE_LIMIT).toBe(5);
    expect(REFERRAL_CODE_CHECK_HOUR_LIMIT).toBe(20);
  });

  it("never puts the raw IP in the rate-limit key", () => {
    const ip = "198.51.100.20";
    const key = buildReferralCheckRateLimitKey(ip, SECRET);
    expect(key).not.toContain(ip);
    expect(key.startsWith("referral_check:")).toBe(true);
  });
});

describe("createReferralCodeCheckTracker (?ref load, blur, submit, stale)", () => {
  it("checks a seeded ?ref code once and dedupes a later blur for the same value", () => {
    const tracker = createReferralCodeCheckTracker();
    const load = tracker.begin("94EK5RB9");
    expect(load.skip).toBe(false);
    if (load.skip) return;
    expect(tracker.accept(load.requestId, load.codeKey, { status: "valid" })).toBe(true);

    const blur = tracker.begin("94EK5RB9");
    expect(blur).toEqual({ skip: true, reason: "deduped" });
  });

  it("forces a fresh submit revalidation even when a prior valid result exists", () => {
    const tracker = createReferralCodeCheckTracker();
    const load = tracker.begin("H37RH6TN");
    if (load.skip) throw new Error("expected check");
    tracker.accept(load.requestId, load.codeKey, { status: "valid" });

    const submit = tracker.begin("H37RH6TN", { force: true });
    expect(submit.skip).toBe(false);
  });

  it("clears feedback on field change and ignores the stale in-flight response", () => {
    const tracker = createReferralCodeCheckTracker();
    const first = tracker.begin("H37RH6TN");
    if (first.skip) throw new Error("expected check");
    tracker.clearOnFieldChange();
    expect(tracker.isStale(first.requestId)).toBe(true);
    expect(tracker.accept(first.requestId, first.codeKey, { status: "valid" })).toBe(false);
    expect(tracker.getSettled()).toBeNull();
  });

  it("skips empty values so submit can proceed without a referral", () => {
    const tracker = createReferralCodeCheckTracker();
    expect(tracker.shouldSkip("   ")).toBe(true);
    expect(tracker.begin("")).toEqual({ skip: true, reason: "empty" });
  });
});

describe("messageForReferralCodeStatus", () => {
  it("uses the approved customer-facing copy and never calls outages or rate limits invalid", () => {
    expect(messageForReferralCodeStatus({ status: "valid" })).toBe(REFERRAL_CODE_APPLIED_MESSAGE);
    expect(messageForReferralCodeStatus({ status: "inactive" })).toBe(REFERRAL_CODE_INACTIVE_MESSAGE);
    expect(messageForReferralCodeStatus({ status: "error" })).toBe(REFERRAL_CODE_CHECK_FAILED_MESSAGE);
    expect(messageForReferralCodeStatus({ status: "rate_limited", retry_after_seconds: 12 })).toBe(
      "Too many tries. Try again in 12 seconds."
    );
    expect(referralCodeRateLimitedMessage(0)).toBe("Too many tries. Try again in 1 seconds.");
    expect(REFERRAL_CODE_CHECK_FAILED_MESSAGE.toLowerCase()).not.toMatch(/invalid|isn't active/);
    expect(referralCodeRateLimitedMessage(5).toLowerCase()).not.toMatch(/invalid|isn't active/);
  });
});

describe("quote-stage must not issue credit", () => {
  it("keeps resolve-booking-referral and attribute_referral as the only attribution path", async () => {
    const { readFileSync } = await import("node:fs");
    const action = readFileSync("src/lib/referrals/check-referral-code-action.ts", "utf8");
    const lookup = readFileSync("src/lib/referrals/lookup-referral-code-active.ts", "utf8");
    const run = readFileSync("src/lib/referrals/run-check-referral-code.ts", "utf8");
    const status = readFileSync("src/lib/referrals/check-referral-code-status.ts", "utf8");
    const combined = `${action}\n${lookup}\n${run}\n${status}`;
    expect(combined).not.toMatch(/attribute_referral|issueCredit|referral_credits/);
    expect(lookup).toContain('.select("active")');
    expect(lookup).not.toMatch(/code_type|recipient_label|referrer_customer|issued_by/);

    const booking = readFileSync("src/lib/referrals/resolve-booking-referral.ts", "utf8");
    expect(booking).toContain(".attribute(");
    expect(booking).toContain("INACTIVE_CODE");

    const wizard = readFileSync("src/components/quote-wizard/QuoteWizard.tsx", "utf8");
    expect(wizard).toContain("checkReferralCodeAction");
    expect(wizard).toContain("force: true");
    expect(wizard).toContain("handleContinueWithoutReferral");
    expect(wizard).toContain("initialReferralCode");
    expect(wizard).toContain("rate_limited");
  });
});
