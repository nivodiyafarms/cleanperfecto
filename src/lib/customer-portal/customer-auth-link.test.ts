import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RuntimeConfigurationError } from "@/lib/config/runtime-env";
import { resolveCustomerAuthOrigin } from "./customer-auth-link";

describe("resolveCustomerAuthOrigin", () => {
  it("local (development, unset NEXT_PUBLIC_SITE_URL) defaults to localhost:3000", () => {
    expect(resolveCustomerAuthOrigin({ appEnv: "development", siteUrl: undefined })).toBe("http://localhost:3000");
  });

  it("test (unset) also defaults to localhost:3000 — the same convenience default as getSiteUrl()", () => {
    expect(resolveCustomerAuthOrigin({ appEnv: "test", siteUrl: undefined })).toBe("http://localhost:3000");
  });

  it("uses an explicitly configured NEXT_PUBLIC_SITE_URL in development instead of the localhost default", () => {
    expect(resolveCustomerAuthOrigin({ appEnv: "development", siteUrl: "http://localhost:4000" })).toBe("http://localhost:4000");
  });

  it("operational_beta with NEXT_PUBLIC_SITE_URL set uses the configured beta origin", () => {
    expect(resolveCustomerAuthOrigin({ appEnv: "operational_beta", siteUrl: "https://beta.cleanperfecto.com" })).toBe(
      "https://beta.cleanperfecto.com"
    );
  });

  it("operational_beta with NEXT_PUBLIC_SITE_URL unset throws rather than silently falling back to localhost", () => {
    expect(() => resolveCustomerAuthOrigin({ appEnv: "operational_beta", siteUrl: undefined })).toThrow(RuntimeConfigurationError);
  });

  it("production with NEXT_PUBLIC_SITE_URL set uses the configured canonical production origin", () => {
    expect(resolveCustomerAuthOrigin({ appEnv: "production", siteUrl: "https://cleanperfecto.com" })).toBe("https://cleanperfecto.com");
  });

  it("production with NEXT_PUBLIC_SITE_URL unset throws — never silently falls back to beta or localhost", () => {
    expect(() => resolveCustomerAuthOrigin({ appEnv: "production", siteUrl: undefined })).toThrow(RuntimeConfigurationError);
  });

  it("strips a trailing slash from a configured site URL", () => {
    expect(resolveCustomerAuthOrigin({ appEnv: "production", siteUrl: "https://cleanperfecto.com/" })).toBe("https://cleanperfecto.com");
  });

  it("rejects an unrecognized APP_ENV value the same way resolveAppEnv itself does", () => {
    expect(() => resolveCustomerAuthOrigin({ appEnv: "staging" })).toThrow(RuntimeConfigurationError);
  });
});

const generateLinkMock = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({ auth: { admin: { generateLink: generateLinkMock } } }),
}));

const { createSupabaseCustomerAuthLinkGenerator } = await import("./customer-auth-link");

describe("createSupabaseCustomerAuthLinkGenerator", () => {
  // The generator resolves its origin from the REAL process.env (it has no
  // request/browser context to read from) — force NEXT_PUBLIC_SITE_URL
  // unset and APP_ENV="test" (one of the two localhost-defaulting
  // environments) so these tests are deterministic regardless of whatever
  // the ambient shell/CI environment happens to have configured.
  const originalSiteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  const originalAppEnv = process.env.APP_ENV;
  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_SITE_URL;
    process.env.APP_ENV = "test";
  });
  afterEach(() => {
    if (originalSiteUrl === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
    else process.env.NEXT_PUBLIC_SITE_URL = originalSiteUrl;
    if (originalAppEnv === undefined) delete process.env.APP_ENV;
    else process.env.APP_ENV = originalAppEnv;
  });

  it("builds a CleanPerfecto-hosted /my/auth/confirm URL from generateLink's hashed_token/verification_type — never Supabase's own action_link/redirect_to", async () => {
    generateLinkMock.mockResolvedValueOnce({
      data: { properties: { action_link: "https://project.supabase.co/auth/v1/verify?token=abc&type=magiclink&redirect_to=...", hashed_token: "hashed-token-abc", verification_type: "magiclink" } },
      error: null,
    });

    const generator = createSupabaseCustomerAuthLinkGenerator();
    const result = await generator.generate("customer@example.com", "/my/payments?visit=visit-123");

    expect(result).toEqual({
      ok: true,
      actionLink: "http://localhost:3000/my/auth/confirm?token_hash=hashed-token-abc&type=magiclink&next=%2Fmy%2Fpayments%3Fvisit%3Dvisit-123",
    });
    // No redirectTo — this flow has no dependency on Supabase's Auth
    // "Redirect URLs" allowlist at all, unlike the old action_link approach.
    expect(generateLinkMock).toHaveBeenCalledWith({ type: "magiclink", email: "customer@example.com" });
  });

  it("never exposes the customer's email in the generated URL — only the opaque token_hash credential", async () => {
    generateLinkMock.mockResolvedValueOnce({
      data: { properties: { action_link: "https://project.supabase.co/auth/v1/verify?token=abc&type=magiclink", hashed_token: "hashed-token-abc", verification_type: "magiclink" } },
      error: null,
    });

    const generator = createSupabaseCustomerAuthLinkGenerator();
    const result = await generator.generate("customer@example.com", "/my/payments?visit=visit-123");

    if (!result.ok) throw new Error("expected ok");
    expect(result.actionLink).not.toContain("customer@example.com");
    expect(result.actionLink).not.toContain("email=");
  });

  it("rejects an out-of-allowlist next path the same way every other portal link does, never building an open redirect", async () => {
    generateLinkMock.mockResolvedValueOnce({
      data: { properties: { action_link: "https://project.supabase.co/auth/v1/verify?token=abc&type=magiclink", hashed_token: "hashed-token-abc", verification_type: "magiclink" } },
      error: null,
    });

    const generator = createSupabaseCustomerAuthLinkGenerator();
    const result = await generator.generate("customer@example.com", "https://evil.example.com");

    expect(result).toEqual({ ok: true, actionLink: "http://localhost:3000/my/auth/confirm?token_hash=hashed-token-abc&type=magiclink&next=%2Fmy" });
  });

  it("returns a failure (never throws) when Supabase's generateLink call itself errors", async () => {
    generateLinkMock.mockResolvedValueOnce({ data: null, error: { message: "rate limited" } });

    const generator = createSupabaseCustomerAuthLinkGenerator();
    const result = await generator.generate("customer@example.com", "/my/payments?visit=visit-123");

    expect(result).toEqual({ ok: false, reason: "rate limited" });
  });

  it("returns a failure when generateLink succeeds but returns no hashed_token", async () => {
    generateLinkMock.mockResolvedValueOnce({ data: { properties: { action_link: "https://project.supabase.co/auth/v1/verify?token=abc" } }, error: null });

    const generator = createSupabaseCustomerAuthLinkGenerator();
    const result = await generator.generate("customer@example.com", "/my/payments?visit=visit-123");

    expect(result).toEqual({ ok: false, reason: "generateLink returned no hashed_token" });
  });
});
