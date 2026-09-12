import { describe, expect, it } from "vitest";
import { resolveRecoveryCallbackRedirectPath } from "./resolve-recovery-callback-redirect";

describe("resolveRecoveryCallbackRedirectPath", () => {
  it("redirects to reset-password on a successful code exchange", () => {
    expect(resolveRecoveryCallbackRedirectPath({ status: "success" })).toBe("/admin/reset-password");
  });

  it("redirects to login when no code was present", () => {
    expect(resolveRecoveryCallbackRedirectPath({ status: "missing_code" })).toBe("/admin/login");
  });

  it("redirects to login when the code exchange failed", () => {
    expect(resolveRecoveryCallbackRedirectPath({ status: "exchange_failed" })).toBe("/admin/login");
  });

  it("never returns anything other than the two fixed internal admin paths", () => {
    const outcomes: Array<Parameters<typeof resolveRecoveryCallbackRedirectPath>[0]> = [
      { status: "success" },
      { status: "missing_code" },
      { status: "exchange_failed" },
    ];
    for (const outcome of outcomes) {
      const path = resolveRecoveryCallbackRedirectPath(outcome);
      expect(["/admin/reset-password", "/admin/login"]).toContain(path);
    }
  });
});
