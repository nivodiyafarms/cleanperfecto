import { describe, expect, it } from "vitest";
import {
  assertCanCalculateStripeTax,
  assertCanCreateStripeCharge,
  assertCanCreateStripeRefund,
  assertCanCreateStripeSetup,
  assertCanRecordExternalPayment,
  canCalculateStripeTax,
  canCreateStripeCharge,
  canCreateStripeRefund,
  canCreateStripeSetup,
  canRecordExternalPayment,
  resolvePaymentCapabilities,
} from "./payment-capabilities";
import { RuntimeConfigurationError } from "./runtime-env";

const TEST_KEYS = { secretKey: "sk_test_abc123", publishableKey: "pk_test_abc123" };
const LIVE_KEYS = { secretKey: "sk_live_abc123", publishableKey: "pk_live_abc123" };

describe("resolvePaymentCapabilities", () => {
  it("disabled blocks Stripe setup/charge, blocks external recording, respects TAX_MODE independently", () => {
    const capabilities = resolvePaymentCapabilities({ appEnv: "production", paymentMode: "disabled", taxMode: "stripe_tax" });
    expect(capabilities).toEqual({
      canCreateStripeSetup: false,
      canCreateStripeCharge: false,
      canCreateStripeRefund: false,
      canRecordExternalPayment: false,
      canCalculateStripeTax: true,
    });
  });

  it("external_only blocks Stripe setup/charge/refund but permits external recording and tax calculation", () => {
    const capabilities = resolvePaymentCapabilities({ appEnv: "production", paymentMode: "external_only", taxMode: "stripe_tax" });
    expect(capabilities).toEqual({
      canCreateStripeSetup: false,
      canCreateStripeCharge: false,
      canCreateStripeRefund: false,
      canRecordExternalPayment: true,
      canCalculateStripeTax: true,
    });
  });

  it("stripe_sandbox (with matching test keys) enables Stripe setup/charge/refund and external recording", () => {
    const capabilities = resolvePaymentCapabilities({
      appEnv: "development",
      paymentMode: "stripe_sandbox",
      taxMode: "disabled",
      stripeKeys: TEST_KEYS,
    });
    expect(capabilities).toEqual({
      canCreateStripeSetup: true,
      canCreateStripeCharge: true,
      canCreateStripeRefund: true,
      canRecordExternalPayment: true,
      canCalculateStripeTax: false,
    });
  });

  it("stripe_enabled (with matching live keys) enables Stripe setup/charge", () => {
    const capabilities = resolvePaymentCapabilities({
      appEnv: "production",
      paymentMode: "stripe_enabled",
      taxMode: "stripe_tax",
      stripeKeys: LIVE_KEYS,
    });
    expect(capabilities.canCreateStripeSetup).toBe(true);
    expect(capabilities.canCreateStripeCharge).toBe(true);
  });

  it("TAX_MODE=disabled blocks tax calculation even when Stripe card payments are fully enabled", () => {
    const capabilities = resolvePaymentCapabilities({
      appEnv: "production",
      paymentMode: "stripe_enabled",
      taxMode: "disabled",
      stripeKeys: LIVE_KEYS,
    });
    expect(capabilities.canCalculateStripeTax).toBe(false);
  });

  it("stripe_sandbox with a LIVE key throws rather than silently resolving capabilities", () => {
    expect(() =>
      resolvePaymentCapabilities({ appEnv: "development", paymentMode: "stripe_sandbox", stripeKeys: LIVE_KEYS })
    ).toThrow(RuntimeConfigurationError);
  });

  it("stripe_enabled with a TEST key throws", () => {
    expect(() =>
      resolvePaymentCapabilities({ appEnv: "production", paymentMode: "stripe_enabled", stripeKeys: TEST_KEYS })
    ).toThrow(RuntimeConfigurationError);
  });

  it("an invalid APP_ENV x PAYMENT_MODE combination throws before key validation even runs", () => {
    expect(() =>
      resolvePaymentCapabilities({ appEnv: "production", paymentMode: "stripe_sandbox", stripeKeys: TEST_KEYS })
    ).toThrow(RuntimeConfigurationError);
  });
});

describe("canX() UI predicates never throw — a broken config resolves to false", () => {
  it("returns false (not a throw) for every capability under an invalid combination", () => {
    const overrides = { appEnv: "production" as const, paymentMode: "stripe_sandbox" as const };
    expect(canCreateStripeSetup(overrides)).toBe(false);
    expect(canCreateStripeCharge(overrides)).toBe(false);
    expect(canRecordExternalPayment(overrides)).toBe(false);
    expect(canCalculateStripeTax(overrides)).toBe(false);
  });

  it("returns false for stripe_sandbox with a live key mismatch, never throws", () => {
    expect(canCreateStripeCharge({ appEnv: "development", paymentMode: "stripe_sandbox", stripeKeys: LIVE_KEYS })).toBe(
      false
    );
  });

  it("returns true when genuinely enabled", () => {
    expect(
      canCreateStripeCharge({ appEnv: "development", paymentMode: "stripe_sandbox", stripeKeys: TEST_KEYS })
    ).toBe(true);
    expect(canRecordExternalPayment({ appEnv: "production", paymentMode: "external_only" })).toBe(true);
  });

  it("canCreateStripeRefund is gated identically to canCreateStripeCharge — false under disabled/external_only, true under a correctly-configured Stripe mode", () => {
    expect(canCreateStripeRefund({ appEnv: "production", paymentMode: "disabled" })).toBe(false);
    expect(canCreateStripeRefund({ appEnv: "production", paymentMode: "external_only" })).toBe(false);
    expect(canCreateStripeRefund({ appEnv: "production", paymentMode: "stripe_enabled", stripeKeys: LIVE_KEYS })).toBe(true);
  });
});

describe("assertX() guards — the authoritative enforcement point", () => {
  it("assertCanCreateStripeSetup throws under disabled", () => {
    expect(() => assertCanCreateStripeSetup({ appEnv: "production", paymentMode: "disabled" })).toThrow(
      RuntimeConfigurationError
    );
  });

  it("assertCanCreateStripeCharge throws under external_only", () => {
    expect(() => assertCanCreateStripeCharge({ appEnv: "production", paymentMode: "external_only" })).toThrow(
      RuntimeConfigurationError
    );
  });

  it("assertCanCreateStripeSetup succeeds under a correctly configured stripe_sandbox", () => {
    expect(() =>
      assertCanCreateStripeSetup({ appEnv: "development", paymentMode: "stripe_sandbox", stripeKeys: TEST_KEYS })
    ).not.toThrow();
  });

  it("assertCanRecordExternalPayment throws only under disabled, succeeds under every other mode", () => {
    expect(() => assertCanRecordExternalPayment({ appEnv: "production", paymentMode: "disabled" })).toThrow(
      RuntimeConfigurationError
    );
    expect(() => assertCanRecordExternalPayment({ appEnv: "production", paymentMode: "external_only" })).not.toThrow();
    expect(() =>
      assertCanRecordExternalPayment({ appEnv: "production", paymentMode: "stripe_enabled", stripeKeys: LIVE_KEYS })
    ).not.toThrow();
  });

  it("assertCanCalculateStripeTax throws under TAX_MODE=disabled regardless of PAYMENT_MODE", () => {
    expect(() =>
      assertCanCalculateStripeTax({ appEnv: "production", paymentMode: "stripe_enabled", taxMode: "disabled", stripeKeys: LIVE_KEYS })
    ).toThrow(RuntimeConfigurationError);
  });

  it("assertCanCalculateStripeTax succeeds under TAX_MODE=stripe_tax even when PAYMENT_MODE=external_only", () => {
    expect(() =>
      assertCanCalculateStripeTax({ appEnv: "production", paymentMode: "external_only", taxMode: "stripe_tax" })
    ).not.toThrow();
  });

  it("assertCanCreateStripeRefund throws under disabled, succeeds under a correctly-configured Stripe mode", () => {
    expect(() => assertCanCreateStripeRefund({ appEnv: "production", paymentMode: "disabled" })).toThrow(RuntimeConfigurationError);
    expect(() =>
      assertCanCreateStripeRefund({ appEnv: "production", paymentMode: "stripe_enabled", stripeKeys: LIVE_KEYS })
    ).not.toThrow();
  });
});
