import { describe, expect, it } from "vitest";
import { resolveCustomerAuthConfirmRedirectPath } from "./resolve-customer-auth-confirm-redirect";

describe("resolveCustomerAuthConfirmRedirectPath", () => {
  it("redirects to /my/activate with the intended destination on a successful token_hash verification", () => {
    expect(resolveCustomerAuthConfirmRedirectPath({ status: "success", next: "/my/payments?visit=visit-123" })).toBe(
      "/my/activate?next=%2Fmy%2Fpayments%3Fvisit%3Dvisit-123"
    );
  });

  it("preserves the intended destination into /my/login when no token_hash/type was present at all — an expired/never-clicked or malformed link should not strand the customer on a context-free sign-in page", () => {
    expect(resolveCustomerAuthConfirmRedirectPath({ status: "missing_token", next: "/my/payments?visit=visit-123" })).toBe(
      "/my/login?next=%2Fmy%2Fpayments%3Fvisit%3Dvisit-123"
    );
  });

  it("preserves the intended destination into /my/login when verifyOtp failed — an expired or already-used link fails safely, but the customer can still get back to Final Total after signing in again", () => {
    expect(resolveCustomerAuthConfirmRedirectPath({ status: "verify_failed", next: "/my/payments?visit=visit-123" })).toBe(
      "/my/login?next=%2Fmy%2Fpayments%3Fvisit%3Dvisit-123"
    );
  });

  it("falls back to the default /my destination on every status when next is just the default — never renders a redundant-but-harmless ?next=%2Fmy as a sign something went wrong", () => {
    expect(resolveCustomerAuthConfirmRedirectPath({ status: "missing_token", next: "/my" })).toBe("/my/login?next=%2Fmy");
    expect(resolveCustomerAuthConfirmRedirectPath({ status: "verify_failed", next: "/my" })).toBe("/my/login?next=%2Fmy");
  });

  it("URL-encodes the next destination so it survives as a single query value, on every status", () => {
    const path = resolveCustomerAuthConfirmRedirectPath({ status: "success", next: "/my/payments?visit=abc&foo=bar" });
    expect(path).toBe("/my/activate?next=%2Fmy%2Fpayments%3Fvisit%3Dabc%26foo%3Dbar");

    const failedPath = resolveCustomerAuthConfirmRedirectPath({ status: "verify_failed", next: "/my/payments?visit=abc&foo=bar" });
    expect(failedPath).toBe("/my/login?next=%2Fmy%2Fpayments%3Fvisit%3Dabc%26foo%3Dbar");
  });

  it("never echoes an external value as-is — this function trusts the caller's sanitization, but its own output never contains a raw, unencoded '//' or 'http' sequence from next", () => {
    // Defense-in-depth sanity check: even an (hypothetically) unsanitized
    // external value passed in would come out percent-encoded, never as a
    // literal second scheme/host inside the path this function returns.
    const path = resolveCustomerAuthConfirmRedirectPath({ status: "verify_failed", next: "https://evil.example.com/phish" });
    expect(path.startsWith("/my/login?next=")).toBe(true);
    expect(path).not.toContain("://evil.example.com");
  });

  const REAL_VISIT_ID = "01684d00-6ba3-4978-9660-518defd828c4";

  it("redirects a FAILED verification whose destination is a real visit's payment review to the branded expired-link page, not the dead-end /my/login — a customer with no session has no way to 'just sign in' there", () => {
    expect(resolveCustomerAuthConfirmRedirectPath({ status: "verify_failed", next: `/my/payments?visit=${REAL_VISIT_ID}` })).toBe(
      `/my/payment-link-expired?visit=${REAL_VISIT_ID}`
    );
    expect(resolveCustomerAuthConfirmRedirectPath({ status: "missing_token", next: `/my/payments?visit=${REAL_VISIT_ID}` })).toBe(
      `/my/payment-link-expired?visit=${REAL_VISIT_ID}`
    );
  });

  it("does NOT redirect to the expired-link page for a non-payment destination, even on failure — /my/login remains correct there", () => {
    expect(resolveCustomerAuthConfirmRedirectPath({ status: "verify_failed", next: "/my/cleanings" })).toBe("/my/login?next=%2Fmy%2Fcleanings");
  });

  it("does NOT redirect to the expired-link page when the visit value isn't actually UUID-shaped — never trusts an arbitrary query value as a real visit id", () => {
    expect(resolveCustomerAuthConfirmRedirectPath({ status: "verify_failed", next: "/my/payments?visit=not-a-real-id" })).toBe(
      "/my/login?next=%2Fmy%2Fpayments%3Fvisit%3Dnot-a-real-id"
    );
  });

  it("does NOT redirect to the expired-link page for a path that merely resembles /my/payments — exact pathname match only", () => {
    expect(resolveCustomerAuthConfirmRedirectPath({ status: "verify_failed", next: `/my/payments-other?visit=${REAL_VISIT_ID}` })).toBe(
      `/my/login?next=%2Fmy%2Fpayments-other%3Fvisit%3D${REAL_VISIT_ID}`
    );
  });

  it("still succeeds to /my/activate on the success path even when next targets a payment visit — the expired-link branch only ever applies to a FAILURE", () => {
    expect(resolveCustomerAuthConfirmRedirectPath({ status: "success", next: `/my/payments?visit=${REAL_VISIT_ID}` })).toBe(
      `/my/activate?next=%2Fmy%2Fpayments%3Fvisit%3D${REAL_VISIT_ID}`
    );
  });
});
