import { describe, expect, it, vi } from "vitest";
import { createFixedWindowRateLimitStore } from "./fixed-window-rate-limit-store";
import {
  RATE_LIMIT_HMAC_SECRET_MIN_LENGTH,
  readRateLimitHmacSecret,
} from "./rate-limit-hmac-secret";
import { createTakeReferralCodeCheckRateLimit } from "@/lib/referrals/referral-code-check-rate-limit";
import {
  REFERRAL_CODE_CHECK_HOUR_LIMIT,
  REFERRAL_CODE_CHECK_MINUTE_LIMIT,
} from "@/lib/referrals/referral-code-check-rate-limit";
import { buildReferralCheckRateLimitKey } from "./rate-limit-key";
import type { ConsumeRateLimitsFn } from "./shared-rate-limit";

const SECRET = "x".repeat(RATE_LIMIT_HMAC_SECRET_MIN_LENGTH);
const IP = "203.0.113.50";

describe("fixed-window rate limit store (SQL semantics)", () => {
  it("allows the minute limit and denies the 6th attempt", () => {
    const store = createFixedWindowRateLimitStore();
    const now = 1_700_000_000_000;
    for (let i = 0; i < 5; i += 1) {
      expect(store.consume("k", 5, 20, now).allowed).toBe(true);
    }
    const denied = store.consume("k", 5, 20, now);
    expect(denied.allowed).toBe(false);
    expect(denied.retry_after_seconds).toBeGreaterThan(0);
  });

  it("denies the 21st attempt on the hour window even when the minute window resets", () => {
    const store = createFixedWindowRateLimitStore();
    // Align to the start of an hour so 4×5 minute-window batches stay inside it.
    const hourStartSec = Math.floor(1_700_000_000 / 3600) * 3600;
    const hourStartMs = hourStartSec * 1000;
    for (let i = 0; i < 20; i += 1) {
      const now = hourStartMs + Math.floor(i / 5) * 60_000;
      expect(store.consume("k", 5, 20, now).allowed).toBe(true);
    }
    const denied = store.consume("k", 5, 20, hourStartMs + 3 * 60_000);
    expect(denied.allowed).toBe(false);
    expect(denied.retry_after_seconds).toBeGreaterThan(0);
  });

  it("resets the minute window at the next 60s boundary", () => {
    const store = createFixedWindowRateLimitStore();
    const t0 = 1_700_000_040_000; // :40 within a minute
    for (let i = 0; i < 5; i += 1) {
      expect(store.consume("k", 5, 20, t0).allowed).toBe(true);
    }
    expect(store.consume("k", 5, 20, t0).allowed).toBe(false);

    const nextWindow = Math.floor(t0 / 60_000) * 60_000 + 60_000;
    expect(store.consume("k", 5, 20, nextWindow).allowed).toBe(true);
  });

  it("keeps the limit under simulated concurrency within one window", async () => {
    const store = createFixedWindowRateLimitStore();
    const now = 1_700_000_100_000;
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        Promise.resolve(store.consume("concurrent", 5, 20, now))
      )
    );
    const allowed = results.filter((r) => r.allowed).length;
    const denied = results.filter((r) => !r.allowed).length;
    expect(allowed).toBe(5);
    expect(denied).toBe(5);
  });
});

describe("createTakeReferralCodeCheckRateLimit", () => {
  it("returns error when the HMAC secret is missing or short", async () => {
    const take = createTakeReferralCodeCheckRateLimit({
      readSecret: () => null,
      consume: vi.fn(),
    });
    await expect(take(IP)).resolves.toEqual({ outcome: "error" });
    expect(readRateLimitHmacSecret("")).toBeNull();
    expect(readRateLimitHmacSecret("short")).toBeNull();
    expect(readRateLimitHmacSecret(SECRET)).toBe(SECRET);
  });

  it("returns error on RPC failure or malformed response and never invents allowed", async () => {
    const rpcError: ConsumeRateLimitsFn = async () => ({ ok: false, reason: "rpc_error" });
    const malformed: ConsumeRateLimitsFn = async () => ({ ok: false, reason: "malformed" });

    await expect(
      createTakeReferralCodeCheckRateLimit({ readSecret: () => SECRET, consume: rpcError })(IP)
    ).resolves.toEqual({ outcome: "error" });

    await expect(
      createTakeReferralCodeCheckRateLimit({ readSecret: () => SECRET, consume: malformed })(IP)
    ).resolves.toEqual({ outcome: "error" });
  });

  it("passes an HMAC key (not the raw IP) and configured limits to the RPC", async () => {
    const consume = vi.fn<ConsumeRateLimitsFn>(async () => ({
      ok: true,
      allowed: true,
      retry_after_seconds: 0,
    }));
    const take = createTakeReferralCodeCheckRateLimit({
      readSecret: () => SECRET,
      consume,
    });
    await expect(take(IP)).resolves.toEqual({ outcome: "allowed" });
    expect(consume).toHaveBeenCalledWith({
      key: buildReferralCheckRateLimitKey(IP, SECRET),
      minuteLimit: REFERRAL_CODE_CHECK_MINUTE_LIMIT,
      hourLimit: REFERRAL_CODE_CHECK_HOUR_LIMIT,
    });
    expect(consume.mock.calls[0]?.[0].key).not.toContain(IP);
  });

  it("maps a denied RPC row to rate_limited with retry_after_seconds", async () => {
    const take = createTakeReferralCodeCheckRateLimit({
      readSecret: () => SECRET,
      consume: async () => ({ ok: true, allowed: false, retry_after_seconds: 42 }),
    });
    await expect(take(IP)).resolves.toEqual({
      outcome: "rate_limited",
      retry_after_seconds: 42,
    });
  });
});
