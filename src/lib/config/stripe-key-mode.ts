import "server-only";

import type { PaymentMode } from "./runtime-env";
import { RuntimeConfigurationError } from "./runtime-env";

export type StripeKeyMode = "test" | "live";

/**
 * Stripe secret-key prefixes this codebase must recognize. `.env.example`
 * explicitly recommends a restricted key (`rk_...`) scoped to only what
 * booking/payment code needs over a broad secret key (`sk_...`) — both
 * forms carry the same `_test_`/`_live_` mode marker, so both are
 * classified identically here rather than only accepting `sk_`.
 */
const SECRET_KEY_TEST_PREFIXES = ["sk_test_", "rk_test_"];
const SECRET_KEY_LIVE_PREFIXES = ["sk_live_", "rk_live_"];
const PUBLISHABLE_KEY_TEST_PREFIX = "pk_test_";
const PUBLISHABLE_KEY_LIVE_PREFIX = "pk_live_";

/** Never returns or logs the key itself — only its classified mode, which is the minimum needed to validate configuration. */
export function classifyStripeSecretKeyMode(key: string): StripeKeyMode | null {
  if (SECRET_KEY_TEST_PREFIXES.some((prefix) => key.startsWith(prefix))) return "test";
  if (SECRET_KEY_LIVE_PREFIXES.some((prefix) => key.startsWith(prefix))) return "live";
  return null;
}

export function classifyStripePublishableKeyMode(key: string): StripeKeyMode | null {
  if (key.startsWith(PUBLISHABLE_KEY_TEST_PREFIX)) return "test";
  if (key.startsWith(PUBLISHABLE_KEY_LIVE_PREFIX)) return "live";
  return null;
}

const REQUIRED_KEY_MODE_BY_PAYMENT_MODE: Partial<Record<PaymentMode, StripeKeyMode>> = {
  stripe_sandbox: "test",
  stripe_enabled: "live",
};

export interface StripeKeyMaterial {
  secretKey: string | undefined;
  publishableKey: string | undefined;
}

/**
 * Validates that the configured Stripe keys agree with PAYMENT_MODE and
 * with each other — the fail-closed check that makes "sandbox mode with a
 * live key" or "live mode with a test key" structurally impossible rather
 * than a matter of remembering to check the Dashboard. A no-op for
 * `disabled`/`external_only`, which carry no Stripe-card key requirement
 * (Stripe may still be used for tax calculation independent of this — see
 * TAX_MODE). The secret key is authoritative: the publishable key's mode is
 * always compared against it, never the other way around. Never includes
 * any part of a key value in a thrown message — only its classified mode.
 */
export function assertStripeKeysMatchPaymentMode(paymentMode: PaymentMode, keys: StripeKeyMaterial): void {
  const requiredMode = REQUIRED_KEY_MODE_BY_PAYMENT_MODE[paymentMode];
  if (!requiredMode) return;

  const { secretKey, publishableKey } = keys;

  if (!secretKey) {
    throw new RuntimeConfigurationError(`PAYMENT_MODE="${paymentMode}" requires STRIPE_SECRET_KEY to be configured.`);
  }
  const secretMode = classifyStripeSecretKeyMode(secretKey);
  if (!secretMode) {
    throw new RuntimeConfigurationError(
      "STRIPE_SECRET_KEY is not a recognized Stripe key format — expected a standard (sk_test_/sk_live_) or restricted (rk_test_/rk_live_) secret key."
    );
  }
  if (secretMode !== requiredMode) {
    throw new RuntimeConfigurationError(
      `PAYMENT_MODE="${paymentMode}" requires a Stripe ${requiredMode}-mode secret key, but the configured STRIPE_SECRET_KEY is ${secretMode}-mode.`
    );
  }

  if (!publishableKey) {
    throw new RuntimeConfigurationError(
      `PAYMENT_MODE="${paymentMode}" requires NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY to be configured.`
    );
  }
  const publishableMode = classifyStripePublishableKeyMode(publishableKey);
  if (!publishableMode) {
    throw new RuntimeConfigurationError(
      "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY is not a recognized Stripe key format — expected pk_test_ or pk_live_."
    );
  }
  if (publishableMode !== secretMode) {
    throw new RuntimeConfigurationError(
      `Stripe key mode mismatch: the secret key is ${secretMode}-mode but NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY is ${publishableMode}-mode — they must agree. The secret key is authoritative.`
    );
  }
}
