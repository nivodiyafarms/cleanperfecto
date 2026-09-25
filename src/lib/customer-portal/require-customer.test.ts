import { describe, expect, it } from "vitest";
import { buildActivateRedirectUrl, resolveCustomerSession } from "./require-customer";

describe("resolveCustomerSession", () => {
  it("is unauthenticated when there is no supabase user id", () => {
    const result = resolveCustomerSession(null, () => ({ id: "acct-1", customerId: "customer-1" }));
    expect(result.status).toBe("unauthenticated");
  });

  it("is not_linked when the supabase user has no customer_accounts row", () => {
    const result = resolveCustomerSession("user-1", () => null);
    expect(result.status).toBe("not_linked");
  });

  it("is authorized when an active customer_accounts row is found, carrying its ids through", () => {
    const result = resolveCustomerSession("user-3", () => ({ id: "acct-99", customerId: "customer-42" }));
    expect(result).toEqual({
      status: "authorized",
      session: { customerAccountId: "acct-99", customerId: "customer-42", supabaseUserId: "user-3" },
    });
  });

  it("only ever looks up the exact supabase user id it was given", () => {
    let queriedId: string | null = null;
    resolveCustomerSession("user-4", (id) => {
      queriedId = id;
      return { id: "acct-4", customerId: "customer-4" };
    });
    expect(queriedId).toBe("user-4");
  });
});

describe("buildActivateRedirectUrl", () => {
  // Regression for a real E2E-discovered bug: a customer's first-ever
  // authenticated portal visit via a deep link (e.g. the Finalize & Send
  // notification's /my/payments?visit=<id>, or the on-site Payment QR)
  // used to land back on the generic /my dashboard after activation,
  // because requireCustomer()'s not_linked redirect dropped the originally
  // -requested path entirely.
  it("preserves a deep link's path and query string", () => {
    expect(buildActivateRedirectUrl("/my/payments?visit=edc7d604-4e54-4746-b968-5c7052fff752")).toBe(
      "/my/activate?next=%2Fmy%2Fpayments%3Fvisit%3Dedc7d604-4e54-4746-b968-5c7052fff752"
    );
  });

  it("defaults to /my when no path was forwarded", () => {
    expect(buildActivateRedirectUrl(null)).toBe("/my/activate?next=%2Fmy");
  });

  it("never forwards a path outside the /my allowlist", () => {
    expect(buildActivateRedirectUrl("https://evil.example/phish")).toBe("/my/activate?next=%2Fmy");
  });
});
