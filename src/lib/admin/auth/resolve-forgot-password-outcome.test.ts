import { describe, expect, it } from "vitest";
import { resolveForgotPasswordOutcome } from "./resolve-forgot-password-outcome";

describe("resolveForgotPasswordOutcome", () => {
  it("reports submitted when the call completed, regardless of whether Supabase found an account", () => {
    expect(resolveForgotPasswordOutcome(false)).toEqual({ status: "submitted" });
  });

  it("reports an unexpected error only when the call itself threw", () => {
    expect(resolveForgotPasswordOutcome(true)).toEqual({ status: "unexpected_error" });
  });
});
