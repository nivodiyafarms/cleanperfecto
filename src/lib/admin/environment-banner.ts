import "server-only";

import { RuntimeConfigurationError, resolveRuntimeConfig, type AppEnv, type PaymentMode, type TaxMode } from "@/lib/config/runtime-env";

export type BannerSeverity = "info" | "warning" | "critical";

export interface EnvironmentBannerData {
  configurationError: false;
  appEnv: AppEnv;
  paymentMode: PaymentMode;
  taxMode: TaxMode;
  label: string;
  taxLabel: string;
  severity: BannerSeverity;
}

export interface EnvironmentBannerConfigError {
  configurationError: true;
  message: string;
}

const APP_ENV_LABELS: Record<AppEnv, string> = {
  development: "Development",
  test: "Test",
  operational_beta: "Operational Beta",
  production: "Production",
};

const PAYMENT_MODE_LABELS: Record<PaymentMode, string> = {
  disabled: "Payments Disabled",
  external_only: "External payments only",
  stripe_sandbox: "Stripe Sandbox (test mode)",
  stripe_enabled: "Live Stripe enabled",
};

const TAX_MODE_LABELS: Record<TaxMode, string> = {
  disabled: "Tax: disabled",
  stripe_tax: "Tax: Stripe Tax",
};

function resolveSeverity(paymentMode: PaymentMode, appEnv: AppEnv): BannerSeverity {
  // The kill switch is always worth a staff member's attention, in every
  // environment — not just production — since it means no payment of any
  // kind (Stripe or external) can currently be recorded.
  if (paymentMode === "disabled") return "critical";
  if (paymentMode === "stripe_enabled") return "warning"; // real money — always call this out, even though it's the expected production state
  if (appEnv === "operational_beta") return "warning";
  return "info";
}

/**
 * Resolves the staff-facing environment banner content — safe display
 * values only (APP_ENV/PAYMENT_MODE/TAX_MODE labels), never a secret, never
 * a key prefix. A RuntimeConfigurationError (invalid enum or a forbidden
 * APP_ENV x PAYMENT_MODE combination) is converted into its own error
 * banner state rather than crashing the admin layout — misconfiguration is
 * exactly the kind of thing staff most need to see, not a blank 500 page.
 */
export function resolveEnvironmentBannerData(): EnvironmentBannerData | EnvironmentBannerConfigError {
  try {
    const config = resolveRuntimeConfig();
    return {
      configurationError: false,
      appEnv: config.appEnv,
      paymentMode: config.paymentMode,
      taxMode: config.taxMode,
      label: `${APP_ENV_LABELS[config.appEnv]} — ${PAYMENT_MODE_LABELS[config.paymentMode]}`,
      taxLabel: TAX_MODE_LABELS[config.taxMode],
      severity: resolveSeverity(config.paymentMode, config.appEnv),
    };
  } catch (error) {
    if (error instanceof RuntimeConfigurationError) {
      return { configurationError: true, message: error.message };
    }
    throw error;
  }
}
