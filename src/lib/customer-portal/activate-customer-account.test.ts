import { describe, expect, it } from "vitest";
import { activateCustomerAccount } from "./activate-customer-account";
import { createFakeCustomerAccountRepository } from "./test-support/fake-customer-account-repository";

describe("activateCustomerAccount", () => {
  it("links a supabase user to the single matching customer", async () => {
    const { repo } = createFakeCustomerAccountRepository({
      customers: [{ id: "customer-1", emailNormalized: "jane@example.com" }],
    });
    const result = await activateCustomerAccount(repo, { supabaseUserId: "auth-1", verifiedEmailNormalized: "jane@example.com" });
    expect(result.outcome).toBe("linked");
    if (result.outcome === "linked") {
      expect(result.account.customerId).toBe("customer-1");
      expect(result.account.supabaseUserId).toBe("auth-1");
    }
  });

  it("is idempotent — a login that's already linked returns already_linked without creating a second row", async () => {
    const { repo, state } = createFakeCustomerAccountRepository({
      customers: [{ id: "customer-1", emailNormalized: "jane@example.com" }],
    });
    await activateCustomerAccount(repo, { supabaseUserId: "auth-1", verifiedEmailNormalized: "jane@example.com" });
    const second = await activateCustomerAccount(repo, { supabaseUserId: "auth-1", verifiedEmailNormalized: "jane@example.com" });
    expect(second.outcome).toBe("already_linked");
    expect(state.accountsById.size).toBe(1);
  });

  it("returns no_match without creating any customer or account when the email matches nothing", async () => {
    const { repo, state } = createFakeCustomerAccountRepository();
    const result = await activateCustomerAccount(repo, { supabaseUserId: "auth-1", verifiedEmailNormalized: "nobody@example.com" });
    expect(result.outcome).toBe("no_match");
    expect(state.accountsById.size).toBe(0);
  });

  it("returns multiple_matches and links nobody when two customers share the email", async () => {
    const { repo, state } = createFakeCustomerAccountRepository({
      customers: [
        { id: "customer-1", emailNormalized: "shared@example.com" },
        { id: "customer-2", emailNormalized: "shared@example.com" },
      ],
    });
    const result = await activateCustomerAccount(repo, { supabaseUserId: "auth-1", verifiedEmailNormalized: "shared@example.com" });
    expect(result.outcome).toBe("multiple_matches");
    if (result.outcome === "multiple_matches") {
      expect(result.customerIds.sort()).toEqual(["customer-1", "customer-2"]);
    }
    expect(state.accountsById.size).toBe(0);
  });

  it("refuses to relink a customer already claimed by a different auth identity", async () => {
    const { repo, state } = createFakeCustomerAccountRepository({
      customers: [{ id: "customer-1", emailNormalized: "jane@example.com" }],
    });
    await activateCustomerAccount(repo, { supabaseUserId: "auth-1", verifiedEmailNormalized: "jane@example.com" });

    const result = await activateCustomerAccount(repo, { supabaseUserId: "auth-2", verifiedEmailNormalized: "jane@example.com" });
    expect(result.outcome).toBe("claimed_by_another_account");
    expect(state.accountsById.size).toBe(1);
  });
});
