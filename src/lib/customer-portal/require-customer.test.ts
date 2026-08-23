import { describe, expect, it } from "vitest";
import { resolveCustomerSession } from "./require-customer";

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
