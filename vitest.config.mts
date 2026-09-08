import { defineConfig } from "vitest/config";
import path from "node:path";

const rootDir = import.meta.dirname;

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(rootDir, "./src"),
      // Next.js aliases "server-only" to this no-op shim at build time for
      // server-side code; replicate that here so tests can import
      // server-only modules directly.
      "server-only": path.resolve(rootDir, "./node_modules/server-only/empty.js"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Default business-runtime posture for the whole test run — matches
    // the genuinely-allowed APP_ENV=test x PAYMENT_MODE=stripe_sandbox
    // combination (see src/lib/config/runtime-env.ts) so the hundreds of
    // pre-existing domain tests (which use fake Stripe gateways and never
    // make a real network call) don't each need to know about Phase 2
    // configuration concepts. These are not real Stripe keys — they only
    // need to match the sk_test_/pk_test_ prefix classifier. Tests that
    // specifically exercise runtime-config/capability behavior override
    // these explicitly per-call rather than relying on process.env.
    env: {
      APP_ENV: "test",
      PAYMENT_MODE: "stripe_sandbox",
      TAX_MODE: "stripe_tax",
      STRIPE_SECRET_KEY: "sk_test_vitest_fixture_key",
      NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_test_vitest_fixture_key",
    },
  },
});
