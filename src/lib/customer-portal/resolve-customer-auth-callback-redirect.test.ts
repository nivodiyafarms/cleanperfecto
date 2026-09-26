import { describe, expect, it } from "vitest";
import { resolveCustomerAuthCallbackRedirectPath } from "./resolve-customer-auth-callback-redirect";

describe("resolveCustomerAuthCallbackRedirectPath", () => {
  it("redirects to /my/activate with the intended destination on a successful code exchange", () => {
    expect(resolveCustomerAuthCallbackRedirectPath({ status: "success", next: "/my/payments?visit=visit-123" })).toBe(
      "/my/activate?next=%2Fmy%2Fpayments%3Fvisit%3Dvisit-123"
    );
  });

  it("redirects to /my/login when no code was present at all — an expired/never-clicked link", () => {
    expect(resolveCustomerAuthCallbackRedirectPath({ status: "missing_code" })).toBe("/my/login");
  });

  it("redirects to /my/login when the code exchange failed — an expired or already-used link fails safely, never a broken/authenticated-looking state", () => {
    expect(resolveCustomerAuthCallbackRedirectPath({ status: "exchange_failed" })).toBe("/my/login");
  });

  it("URL-encodes the next destination so it survives as a single query value", () => {
    const path = resolveCustomerAuthCallbackRedirectPath({ status: "success", next: "/my/payments?visit=abc&foo=bar" });
    expect(path).toBe("/my/activate?next=%2Fmy%2Fpayments%3Fvisit%3Dabc%26foo%3Dbar");
  });
});
