import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildReferralCheckRateLimitKey, REFERRAL_CHECK_RATE_LIMIT_KEY_PREFIX } from "./rate-limit-key";

const SECRET = "a".repeat(32);

describe("buildReferralCheckRateLimitKey", () => {
  it("returns referral_check: plus hex HMAC of the normalized IP — never the raw IP", () => {
    const key = buildReferralCheckRateLimitKey("203.0.113.9", SECRET);
    expect(key.startsWith(REFERRAL_CHECK_RATE_LIMIT_KEY_PREFIX)).toBe(true);
    expect(key).not.toContain("203.0.113.9");
    expect(key).toMatch(/^referral_check:[0-9a-f]{64}$/);

    const expected = createHmac("sha256", SECRET).update("203.0.113.9", "utf8").digest("hex");
    expect(key).toBe(`${REFERRAL_CHECK_RATE_LIMIT_KEY_PREFIX}${expected}`);
  });

  it("normalizes before hashing so bracketed/mapped forms share a key", () => {
    const a = buildReferralCheckRateLimitKey("::ffff:203.0.113.9", SECRET);
    const b = buildReferralCheckRateLimitKey("203.0.113.9", SECRET);
    const c = buildReferralCheckRateLimitKey("  203.0.113.9  ", SECRET);
    expect(a).toBe(b);
    expect(b).toBe(c);
  });
});
