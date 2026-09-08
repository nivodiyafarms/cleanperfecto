import { describe, expect, it } from "vitest";
import {
  APP_ENV_VALUES,
  PAYMENT_MODE_VALUES,
  RuntimeConfigurationError,
  TAX_MODE_VALUES,
  assertPaymentModeAllowed,
  isPaymentModeAllowed,
  resolveAppEnv,
  resolvePaymentMode,
  resolveRuntimeConfig,
  resolveTaxMode,
} from "./runtime-env";
import type { AppEnv, PaymentMode } from "./runtime-env";

describe("resolveAppEnv", () => {
  it("resolves every canonical value unchanged", () => {
    for (const value of APP_ENV_VALUES) {
      expect(resolveAppEnv(value)).toBe(value);
    }
  });

  it("defaults to development when blank", () => {
    // Note: passing the literal `undefined` here would fall through to this
    // function's own `= process.env.APP_ENV` default parameter and pick up
    // whatever the real environment has configured (vitest.config.mts sets
    // APP_ENV=test for the whole suite — see that file's comment) — so
    // "absent" is exercised via an explicit blank string instead, which is
    // never subject to default-parameter substitution.
    expect(resolveAppEnv("")).toBe("development");
  });

  it("throws on an unrecognized value rather than silently defaulting", () => {
    expect(() => resolveAppEnv("prod")).toThrow(RuntimeConfigurationError);
    expect(() => resolveAppEnv("Production")).toThrow(RuntimeConfigurationError);
    expect(() => resolveAppEnv(" production")).toThrow(RuntimeConfigurationError);
  });
});

describe("resolvePaymentMode", () => {
  it("resolves every canonical value unchanged", () => {
    for (const value of PAYMENT_MODE_VALUES) {
      expect(resolvePaymentMode(value)).toBe(value);
    }
  });

  it("defaults to disabled when blank — payments are never silently enabled", () => {
    expect(resolvePaymentMode("")).toBe("disabled");
  });

  it("throws on an unrecognized value", () => {
    expect(() => resolvePaymentMode("live")).toThrow(RuntimeConfigurationError);
    expect(() => resolvePaymentMode("STRIPE_ENABLED")).toThrow(RuntimeConfigurationError);
  });
});

describe("resolveTaxMode", () => {
  it("resolves every canonical value unchanged", () => {
    for (const value of TAX_MODE_VALUES) {
      expect(resolveTaxMode(value)).toBe(value);
    }
  });

  it("defaults to disabled when blank", () => {
    expect(resolveTaxMode("")).toBe("disabled");
  });

  it("throws on an unrecognized value", () => {
    expect(() => resolveTaxMode("texas_local")).toThrow(RuntimeConfigurationError);
  });
});

describe("APP_ENV x PAYMENT_MODE compatibility matrix", () => {
  const EXPECTED: Record<AppEnv, Record<PaymentMode, boolean>> = {
    development: { disabled: true, external_only: true, stripe_sandbox: true, stripe_enabled: false },
    test: { disabled: true, external_only: true, stripe_sandbox: true, stripe_enabled: false },
    operational_beta: { disabled: true, external_only: true, stripe_sandbox: false, stripe_enabled: true },
    production: { disabled: true, external_only: true, stripe_sandbox: false, stripe_enabled: true },
  };

  for (const appEnv of APP_ENV_VALUES) {
    for (const paymentMode of PAYMENT_MODE_VALUES) {
      const expected = EXPECTED[appEnv][paymentMode];
      it(`${appEnv} x ${paymentMode} -> ${expected ? "allowed" : "FORBIDDEN"}`, () => {
        expect(isPaymentModeAllowed(appEnv, paymentMode)).toBe(expected);
        if (expected) {
          expect(() => assertPaymentModeAllowed(appEnv, paymentMode)).not.toThrow();
        } else {
          expect(() => assertPaymentModeAllowed(appEnv, paymentMode)).toThrow(RuntimeConfigurationError);
        }
      });
    }
  }
});

describe("resolveRuntimeConfig", () => {
  it("returns the resolved triple for a valid, fully-specified configuration", () => {
    const config = resolveRuntimeConfig({ appEnv: "production", paymentMode: "stripe_enabled", taxMode: "stripe_tax" });
    expect(config).toEqual({ appEnv: "production", paymentMode: "stripe_enabled", taxMode: "stripe_tax" });
  });

  it("absent PAYMENT_MODE does not enable payments even in production", () => {
    // Blank, not omitted — an omitted field falls through to process.env,
    // which vitest.config.mts deliberately populates for the rest of the
    // suite (see that file's comment); a blank string is never subject to
    // that fallback and reliably exercises true absence here.
    const config = resolveRuntimeConfig({ appEnv: "production", paymentMode: "", taxMode: "" });
    expect(config.paymentMode).toBe("disabled");
  });

  it("absent everything resolves to the fully safe development/disabled/disabled default", () => {
    const config = resolveRuntimeConfig({ appEnv: "", paymentMode: "", taxMode: "" });
    expect(config).toEqual({ appEnv: "development", paymentMode: "disabled", taxMode: "disabled" });
  });

  it("rejects development + live Stripe (stripe_enabled)", () => {
    expect(() => resolveRuntimeConfig({ appEnv: "development", paymentMode: "stripe_enabled" })).toThrow(
      RuntimeConfigurationError
    );
  });

  it("rejects test + live Stripe (stripe_enabled)", () => {
    expect(() => resolveRuntimeConfig({ appEnv: "test", paymentMode: "stripe_enabled" })).toThrow(RuntimeConfigurationError);
  });

  it("rejects operational_beta + sandbox Stripe", () => {
    expect(() => resolveRuntimeConfig({ appEnv: "operational_beta", paymentMode: "stripe_sandbox" })).toThrow(
      RuntimeConfigurationError
    );
  });

  it("rejects production + sandbox Stripe", () => {
    expect(() => resolveRuntimeConfig({ appEnv: "production", paymentMode: "stripe_sandbox" })).toThrow(
      RuntimeConfigurationError
    );
  });

  it("propagates an invalid enum string as a RuntimeConfigurationError, never silently downgraded", () => {
    expect(() => resolveRuntimeConfig({ appEnv: "staging" })).toThrow(RuntimeConfigurationError);
    expect(() => resolveRuntimeConfig({ paymentMode: "test_mode" })).toThrow(RuntimeConfigurationError);
    expect(() => resolveRuntimeConfig({ taxMode: "flat_rate" })).toThrow(RuntimeConfigurationError);
  });
});
