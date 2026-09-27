import { describe, expect, it } from "vitest";
import { resolveCustomerAuthConfirmRedirectPath } from "./resolve-customer-auth-confirm-redirect";

describe("resolveCustomerAuthConfirmRedirectPath", () => {
  it("redirects to /my/activate with the intended destination on a successful token_hash verification", () => {
    expect(resolveCustomerAuthConfirmRedirectPath({ status: "success", next: "/my/payments?visit=visit-123" })).toBe(
      "/my/activate?next=%2Fmy%2Fpayments%3Fvisit%3Dvisit-123"
    );
  });

  it("redirects to /my/login when no token_hash/type was present at all — an expired/never-clicked or malformed link", () => {
    expect(resolveCustomerAuthConfirmRedirectPath({ status: "missing_token" })).toBe("/my/login");
  });

  it("redirects to /my/login when verifyOtp failed — an expired or already-used link fails safely, never a broken/authenticated-looking state", () => {
    expect(resolveCustomerAuthConfirmRedirectPath({ status: "verify_failed" })).toBe("/my/login");
  });

  it("URL-encodes the next destination so it survives as a single query value", () => {
    const path = resolveCustomerAuthConfirmRedirectPath({ status: "success", next: "/my/payments?visit=abc&foo=bar" });
    expect(path).toBe("/my/activate?next=%2Fmy%2Fpayments%3Fvisit%3Dabc%26foo%3Dbar");
  });
});
