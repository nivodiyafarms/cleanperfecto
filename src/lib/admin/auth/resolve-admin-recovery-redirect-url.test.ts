import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveAdminRecoveryRedirectUrl } from "./resolve-admin-recovery-redirect-url";

describe("resolveAdminRecoveryRedirectUrl", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("resolves to the exact local callback URL when NEXT_PUBLIC_SITE_URL is unset", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
    expect(resolveAdminRecoveryRedirectUrl()).toBe("http://localhost:3000/admin/auth/callback");
  });

  it("resolves against the configured site URL", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://cleanperfecto.com");
    expect(resolveAdminRecoveryRedirectUrl()).toBe("https://cleanperfecto.com/admin/auth/callback");
  });

  it("strips a trailing slash from the configured site URL", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://cleanperfecto.com/");
    expect(resolveAdminRecoveryRedirectUrl()).toBe("https://cleanperfecto.com/admin/auth/callback");
  });
});
