import { describe, expect, it } from "vitest";
import { resolveRuntimeConfig } from "@/lib/config/runtime-env";
import { resolveEnvironmentBannerData } from "./environment-banner";

// resolveEnvironmentBannerData reads process.env directly (no override
// param — it's meant to be called once, server-side, per request), so
// these tests set process.env for the duration of each case and restore it
// afterward, same approach as any other env-dependent test in this suite.
function withEnv<T>(env: Record<string, string | undefined>, run: () => T): T {
  const previous: Record<string, string | undefined> = {};
  for (const key of Object.keys(env)) previous[key] = process.env[key];
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return run();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

describe("resolveEnvironmentBannerData", () => {
  it("operational_beta + external_only produces the documented label", () => {
    const result = withEnv({ APP_ENV: "operational_beta", PAYMENT_MODE: "external_only" }, resolveEnvironmentBannerData);
    expect(result).toMatchObject({ configurationError: false, label: "Operational Beta — External payments only" });
  });

  it("operational_beta + stripe_enabled produces the documented label", () => {
    const result = withEnv(
      { APP_ENV: "operational_beta", PAYMENT_MODE: "stripe_enabled" },
      resolveEnvironmentBannerData
    );
    expect(result).toMatchObject({ configurationError: false, label: "Operational Beta — Live Stripe enabled" });
  });

  it("production + disabled is flagged critical severity — the high-visibility payment-disabled warning", () => {
    const result = withEnv({ APP_ENV: "production", PAYMENT_MODE: "disabled" }, resolveEnvironmentBannerData);
    expect(result).toMatchObject({ configurationError: false, severity: "critical", label: "Production — Payments Disabled" });
  });

  it("never includes a secret or key prefix — only the three safe enum values", () => {
    const result = withEnv({ APP_ENV: "production", PAYMENT_MODE: "stripe_enabled" }, resolveEnvironmentBannerData);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(/sk_|pk_|rk_|whsec_/);
  });

  it("surfaces an invalid configuration as a distinct error state rather than throwing", () => {
    const result = withEnv({ APP_ENV: "production", PAYMENT_MODE: "stripe_sandbox" }, resolveEnvironmentBannerData);
    expect(result.configurationError).toBe(true);
  });

  it("sanity-checks against the real resolver: a valid config never reports configurationError", () => {
    const config = resolveRuntimeConfig({ appEnv: "development", paymentMode: "disabled" });
    const result = withEnv({ APP_ENV: config.appEnv, PAYMENT_MODE: config.paymentMode }, resolveEnvironmentBannerData);
    expect(result.configurationError).toBe(false);
  });
});
