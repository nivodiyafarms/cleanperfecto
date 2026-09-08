import "server-only";

import { assertStripeKeysMatchPaymentMode, type StripeKeyMaterial } from "./stripe-key-mode";
import { RuntimeConfigurationError, resolveRuntimeConfig, type RuntimeConfigOverrides } from "./runtime-env";

/**
 * The single centralized authorization surface for every money-changing
 * server path in this codebase. No server action, domain function, or
 * Stripe-facing gateway should ever branch on `process.env.PAYMENT_MODE`
 * (or APP_ENV/TAX_MODE) directly — everything routes through here, so a
 * capability can never be checked inconsistently between two call sites.
 * UI code may call the boolean `canX()` predicates to decide what to
 * render, but that is a courtesy only — every actual mutation path also
 * calls the matching `assertX()` guard, which is the real enforcement
 * point and cannot be bypassed by hiding a button.
 */

export interface PaymentCapabilities {
  /** Stripe SetupIntent / payment-method collection (booking setup, "Add/Update Payment Method"). */
  canCreateStripeSetup: boolean;
  /** Stripe PaymentIntent creation or a `mode: "payment"` Checkout Session (post-cleaning charge, prepaid package purchase). */
  canCreateStripeCharge: boolean;
  /** Recording a genuine Zelle/Cash external receipt through the existing frozen/system-derived amount flow. */
  canRecordExternalPayment: boolean;
  /** Stripe Tax calculation/transaction creation — independent of PAYMENT_MODE, since external settlements can still require authoritative tax. */
  canCalculateStripeTax: boolean;
}

export interface PaymentCapabilityOverrides extends RuntimeConfigOverrides {
  stripeKeys?: StripeKeyMaterial;
}

function resolveStripeKeyMaterialFromEnv(): StripeKeyMaterial {
  return {
    secretKey: process.env.STRIPE_SECRET_KEY,
    publishableKey: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
  };
}

/**
 * Resolves the full capability set for the current configuration. Throws
 * RuntimeConfigurationError (never returns a "safe-looking" false set) if
 * the configuration itself is invalid (bad enum, forbidden APP_ENV x
 * PAYMENT_MODE combination) or — whenever a Stripe card flow is
 * enabled — if the configured Stripe keys don't agree with PAYMENT_MODE or
 * with each other. A caller that only wants "is X allowed" for UI display
 * should catch RuntimeConfigurationError and treat it as "no, and something
 * is misconfigured" rather than silently defaulting capabilities to true.
 */
export function resolvePaymentCapabilities(overrides?: PaymentCapabilityOverrides): PaymentCapabilities {
  const config = resolveRuntimeConfig(overrides);
  const stripeCardEnabled = config.paymentMode === "stripe_sandbox" || config.paymentMode === "stripe_enabled";

  if (stripeCardEnabled) {
    assertStripeKeysMatchPaymentMode(config.paymentMode, overrides?.stripeKeys ?? resolveStripeKeyMaterialFromEnv());
  }

  return {
    canCreateStripeSetup: stripeCardEnabled,
    canCreateStripeCharge: stripeCardEnabled,
    canRecordExternalPayment: config.paymentMode !== "disabled",
    canCalculateStripeTax: config.taxMode === "stripe_tax",
  };
}

/**
 * UI-facing predicates. Each swallows a RuntimeConfigurationError into
 * `false` — a broken configuration should never let the customer/admin UI
 * throw; it should simply decline to offer the capability. The authoritative
 * `assertX()` guards below are what actually block a mutation.
 */
function safeCapability(check: (capabilities: PaymentCapabilities) => boolean, overrides?: PaymentCapabilityOverrides): boolean {
  try {
    return check(resolvePaymentCapabilities(overrides));
  } catch (error) {
    if (error instanceof RuntimeConfigurationError) return false;
    throw error;
  }
}

export function canCreateStripeSetup(overrides?: PaymentCapabilityOverrides): boolean {
  return safeCapability((c) => c.canCreateStripeSetup, overrides);
}
export function canCreateStripeCharge(overrides?: PaymentCapabilityOverrides): boolean {
  return safeCapability((c) => c.canCreateStripeCharge, overrides);
}
export function canRecordExternalPayment(overrides?: PaymentCapabilityOverrides): boolean {
  return safeCapability((c) => c.canRecordExternalPayment, overrides);
}
export function canCalculateStripeTax(overrides?: PaymentCapabilityOverrides): boolean {
  return safeCapability((c) => c.canCalculateStripeTax, overrides);
}

/**
 * Authoritative server-side guards — the mandatory enforcement point every
 * money-changing path must call before doing anything else. Unlike the
 * `canX()` predicates above, these never swallow a configuration error:
 * an invalid/forbidden configuration and a validly-configured-but-disabled
 * capability both block the operation, they just do so with a message that
 * distinguishes "not configured" from "this environment doesn't allow it."
 */
export function assertCanCreateStripeSetup(overrides?: PaymentCapabilityOverrides): void {
  const capabilities = resolvePaymentCapabilities(overrides);
  if (!capabilities.canCreateStripeSetup) {
    throw new RuntimeConfigurationError(
      "Stripe payment-method setup is not available — PAYMENT_MODE does not currently permit Stripe card flows."
    );
  }
}

export function assertCanCreateStripeCharge(overrides?: PaymentCapabilityOverrides): void {
  const capabilities = resolvePaymentCapabilities(overrides);
  if (!capabilities.canCreateStripeCharge) {
    throw new RuntimeConfigurationError(
      "Stripe charge creation is not available — PAYMENT_MODE does not currently permit Stripe card flows."
    );
  }
}

export function assertCanRecordExternalPayment(overrides?: PaymentCapabilityOverrides): void {
  const capabilities = resolvePaymentCapabilities(overrides);
  if (!capabilities.canRecordExternalPayment) {
    throw new RuntimeConfigurationError(
      "External (Zelle/Cash) payment recording is not available — PAYMENT_MODE is currently \"disabled\" (emergency kill switch)."
    );
  }
}

export function assertCanCalculateStripeTax(overrides?: PaymentCapabilityOverrides): void {
  const capabilities = resolvePaymentCapabilities(overrides);
  if (!capabilities.canCalculateStripeTax) {
    throw new RuntimeConfigurationError(
      "Stripe Tax calculation is not available — TAX_MODE is currently \"disabled\". No local tax engine exists to fall back to."
    );
  }
}
