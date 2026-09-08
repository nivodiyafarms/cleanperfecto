import "server-only";

/**
 * The single authoritative source of business-runtime environment
 * configuration. Every payment/tax-adjacent code path reads its
 * environment/payment/tax posture through this module — never by
 * interpreting `process.env` directly, and never by inferring anything
 * from `NODE_ENV` (a build/tooling concept, not a business-safety one).
 *
 * Fail-closed philosophy for money-changing behavior:
 *  - APP_ENV absent -> "development" (the most restrictive environment;
 *    forbids stripe_enabled outright — see the compatibility matrix below).
 *    This is the "safe development state" local non-payment work resolves
 *    to without any configuration at all.
 *  - PAYMENT_MODE absent -> "disabled" (the emergency-kill-switch state) —
 *    an unconfigured environment can never accidentally enable a Stripe
 *    card flow or an external-receipt recording.
 *  - TAX_MODE absent -> "disabled" — no Stripe Tax calculation is ever
 *    initiated without an explicit opt-in.
 * A PRESENT but unrecognized value for any of the three is never silently
 * reinterpreted as one of the above defaults — that would mask a real typo
 * in a way that could go unnoticed for a long time. It throws
 * RuntimeConfigurationError instead, failing loudly and blocking the
 * operation, exactly like an invalid APP_ENV x PAYMENT_MODE combination.
 */

export type AppEnv = "development" | "test" | "operational_beta" | "production";
export type PaymentMode = "disabled" | "external_only" | "stripe_sandbox" | "stripe_enabled";
export type TaxMode = "disabled" | "stripe_tax";

export const APP_ENV_VALUES: readonly AppEnv[] = ["development", "test", "operational_beta", "production"];
export const PAYMENT_MODE_VALUES: readonly PaymentMode[] = [
  "disabled",
  "external_only",
  "stripe_sandbox",
  "stripe_enabled",
];
export const TAX_MODE_VALUES: readonly TaxMode[] = ["disabled", "stripe_tax"];

/** Raised for any absent-but-required, invalid, or structurally incompatible business-runtime configuration. Callers should treat this as "block the operation" — never caught and silently downgraded to a default. */
export class RuntimeConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RuntimeConfigurationError";
  }
}

function isOneOf<T extends string>(value: string, values: readonly T[]): value is T {
  return (values as readonly string[]).includes(value);
}

export function resolveAppEnv(raw: string | undefined = process.env.APP_ENV): AppEnv {
  if (raw === undefined || raw === "") return "development";
  if (!isOneOf(raw, APP_ENV_VALUES)) {
    throw new RuntimeConfigurationError(
      `APP_ENV is set to an unrecognized value. Must be one of: ${APP_ENV_VALUES.join(", ")}.`
    );
  }
  return raw;
}

export function resolvePaymentMode(raw: string | undefined = process.env.PAYMENT_MODE): PaymentMode {
  if (raw === undefined || raw === "") return "disabled";
  if (!isOneOf(raw, PAYMENT_MODE_VALUES)) {
    throw new RuntimeConfigurationError(
      `PAYMENT_MODE is set to an unrecognized value. Must be one of: ${PAYMENT_MODE_VALUES.join(", ")}.`
    );
  }
  return raw;
}

export function resolveTaxMode(raw: string | undefined = process.env.TAX_MODE): TaxMode {
  if (raw === undefined || raw === "") return "disabled";
  if (!isOneOf(raw, TAX_MODE_VALUES)) {
    throw new RuntimeConfigurationError(`TAX_MODE is set to an unrecognized value. Must be one of: ${TAX_MODE_VALUES.join(", ")}.`);
  }
  return raw;
}

/**
 * The explicit APP_ENV x PAYMENT_MODE compatibility matrix — the single
 * source of truth for which combinations may ever run. `stripe_sandbox`
 * (test Stripe keys/events) is confined to development/test so a sandbox
 * habit can never quietly follow a deploy into a beta/production
 * environment; `stripe_enabled` (live keys/events, real money) is confined
 * to operational_beta/production so a developer's live keys can never be
 * exercised from a laptop. `disabled` and `external_only` are always safe,
 * in every environment.
 */
export const PAYMENT_MODE_COMPATIBILITY: Readonly<Record<AppEnv, Readonly<Record<PaymentMode, boolean>>>> = {
  development: { disabled: true, external_only: true, stripe_sandbox: true, stripe_enabled: false },
  test: { disabled: true, external_only: true, stripe_sandbox: true, stripe_enabled: false },
  operational_beta: { disabled: true, external_only: true, stripe_sandbox: false, stripe_enabled: true },
  production: { disabled: true, external_only: true, stripe_sandbox: false, stripe_enabled: true },
};

export function isPaymentModeAllowed(appEnv: AppEnv, paymentMode: PaymentMode): boolean {
  return PAYMENT_MODE_COMPATIBILITY[appEnv][paymentMode];
}

export function assertPaymentModeAllowed(appEnv: AppEnv, paymentMode: PaymentMode): void {
  if (isPaymentModeAllowed(appEnv, paymentMode)) return;

  const reason =
    paymentMode === "stripe_sandbox"
      ? "stripe_sandbox (test Stripe keys/events) is only permitted when APP_ENV is development or test."
      : paymentMode === "stripe_enabled"
        ? "stripe_enabled (live Stripe keys/events) is only permitted when APP_ENV is operational_beta or production."
        : `PAYMENT_MODE="${paymentMode}" is not permitted when APP_ENV="${appEnv}".`;

  throw new RuntimeConfigurationError(
    `Invalid configuration: PAYMENT_MODE="${paymentMode}" is forbidden when APP_ENV="${appEnv}". ${reason}`
  );
}

export interface RuntimeConfig {
  appEnv: AppEnv;
  paymentMode: PaymentMode;
  taxMode: TaxMode;
}

export interface RuntimeConfigOverrides {
  appEnv?: string;
  paymentMode?: string;
  taxMode?: string;
}

/**
 * The one function application code should call to get a fully validated
 * runtime posture. Always re-derives from `process.env` (or the supplied
 * per-call test overrides — the same "inject the seam" pattern used
 * throughout this codebase, e.g. `asOf` in the pricing engine) rather than
 * caching at module load, so a single process can never be "stuck" on a
 * stale config across environments in a test run. Throws
 * RuntimeConfigurationError — and therefore blocks the caller — for any
 * invalid enum value or forbidden APP_ENV x PAYMENT_MODE combination.
 */
export function resolveRuntimeConfig(overrides?: RuntimeConfigOverrides): RuntimeConfig {
  const appEnv = resolveAppEnv(overrides?.appEnv ?? process.env.APP_ENV);
  const paymentMode = resolvePaymentMode(overrides?.paymentMode ?? process.env.PAYMENT_MODE);
  const taxMode = resolveTaxMode(overrides?.taxMode ?? process.env.TAX_MODE);
  assertPaymentModeAllowed(appEnv, paymentMode);
  return { appEnv, paymentMode, taxMode };
}
