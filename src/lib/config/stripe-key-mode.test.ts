import { describe, expect, it } from "vitest";
import {
  assertStripeKeysMatchPaymentMode,
  classifyStripePublishableKeyMode,
  classifyStripeSecretKeyMode,
} from "./stripe-key-mode";
import { RuntimeConfigurationError } from "./runtime-env";

const TEST_SECRET = "sk_test_abc123";
const LIVE_SECRET = "sk_live_abc123";
const TEST_RESTRICTED = "rk_test_abc123";
const LIVE_RESTRICTED = "rk_live_abc123";
const TEST_PUBLISHABLE = "pk_test_abc123";
const LIVE_PUBLISHABLE = "pk_live_abc123";

describe("classifyStripeSecretKeyMode", () => {
  it("classifies standard sk_test_/sk_live_ keys", () => {
    expect(classifyStripeSecretKeyMode(TEST_SECRET)).toBe("test");
    expect(classifyStripeSecretKeyMode(LIVE_SECRET)).toBe("live");
  });

  it("classifies restricted rk_test_/rk_live_ keys — the .env.example-recommended form", () => {
    expect(classifyStripeSecretKeyMode(TEST_RESTRICTED)).toBe("test");
    expect(classifyStripeSecretKeyMode(LIVE_RESTRICTED)).toBe("live");
  });

  it("returns null for an unrecognized format", () => {
    expect(classifyStripeSecretKeyMode("not-a-stripe-key")).toBeNull();
    expect(classifyStripeSecretKeyMode("pk_test_abc123")).toBeNull();
  });
});

describe("classifyStripePublishableKeyMode", () => {
  it("classifies pk_test_/pk_live_", () => {
    expect(classifyStripePublishableKeyMode(TEST_PUBLISHABLE)).toBe("test");
    expect(classifyStripePublishableKeyMode(LIVE_PUBLISHABLE)).toBe("live");
  });

  it("returns null for an unrecognized format", () => {
    expect(classifyStripePublishableKeyMode("sk_test_abc123")).toBeNull();
  });
});

describe("assertStripeKeysMatchPaymentMode", () => {
  it("is a no-op for disabled and external_only regardless of key state", () => {
    expect(() =>
      assertStripeKeysMatchPaymentMode("disabled", { secretKey: undefined, publishableKey: undefined })
    ).not.toThrow();
    expect(() =>
      assertStripeKeysMatchPaymentMode("external_only", { secretKey: LIVE_SECRET, publishableKey: TEST_PUBLISHABLE })
    ).not.toThrow();
  });

  it("stripe_sandbox accepts a matching test secret + publishable pair (standard keys)", () => {
    expect(() =>
      assertStripeKeysMatchPaymentMode("stripe_sandbox", { secretKey: TEST_SECRET, publishableKey: TEST_PUBLISHABLE })
    ).not.toThrow();
  });

  it("stripe_sandbox accepts a matching test pair using the restricted (rk_test_) secret form", () => {
    expect(() =>
      assertStripeKeysMatchPaymentMode("stripe_sandbox", { secretKey: TEST_RESTRICTED, publishableKey: TEST_PUBLISHABLE })
    ).not.toThrow();
  });

  it("stripe_enabled accepts a matching live secret + publishable pair", () => {
    expect(() =>
      assertStripeKeysMatchPaymentMode("stripe_enabled", { secretKey: LIVE_SECRET, publishableKey: LIVE_PUBLISHABLE })
    ).not.toThrow();
  });

  it("stripe_enabled accepts the restricted (rk_live_) secret form", () => {
    expect(() =>
      assertStripeKeysMatchPaymentMode("stripe_enabled", { secretKey: LIVE_RESTRICTED, publishableKey: LIVE_PUBLISHABLE })
    ).not.toThrow();
  });

  it("rejects development/test-style stripe_sandbox with a LIVE secret key", () => {
    expect(() =>
      assertStripeKeysMatchPaymentMode("stripe_sandbox", { secretKey: LIVE_SECRET, publishableKey: TEST_PUBLISHABLE })
    ).toThrow(RuntimeConfigurationError);
  });

  it("rejects stripe_enabled with a TEST secret key", () => {
    expect(() =>
      assertStripeKeysMatchPaymentMode("stripe_enabled", { secretKey: TEST_SECRET, publishableKey: LIVE_PUBLISHABLE })
    ).toThrow(RuntimeConfigurationError);
  });

  it("rejects a publishable/secret mode disagreement even when each individually matches a different valid mode", () => {
    expect(() =>
      assertStripeKeysMatchPaymentMode("stripe_sandbox", { secretKey: TEST_SECRET, publishableKey: LIVE_PUBLISHABLE })
    ).toThrow(RuntimeConfigurationError);
    expect(() =>
      assertStripeKeysMatchPaymentMode("stripe_enabled", { secretKey: LIVE_SECRET, publishableKey: TEST_PUBLISHABLE })
    ).toThrow(RuntimeConfigurationError);
  });

  it("rejects a missing secret key", () => {
    expect(() =>
      assertStripeKeysMatchPaymentMode("stripe_sandbox", { secretKey: undefined, publishableKey: TEST_PUBLISHABLE })
    ).toThrow(RuntimeConfigurationError);
  });

  it("rejects a missing publishable key", () => {
    expect(() =>
      assertStripeKeysMatchPaymentMode("stripe_sandbox", { secretKey: TEST_SECRET, publishableKey: undefined })
    ).toThrow(RuntimeConfigurationError);
  });

  it("rejects an unrecognized secret key format", () => {
    expect(() =>
      assertStripeKeysMatchPaymentMode("stripe_sandbox", { secretKey: "garbage", publishableKey: TEST_PUBLISHABLE })
    ).toThrow(RuntimeConfigurationError);
  });

  it("never includes the key value itself in the thrown error message", () => {
    try {
      assertStripeKeysMatchPaymentMode("stripe_enabled", { secretKey: TEST_SECRET, publishableKey: LIVE_PUBLISHABLE });
      expect.fail("expected a throw");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).not.toContain(TEST_SECRET);
      expect(message).not.toContain("abc123");
    }
  });
});
