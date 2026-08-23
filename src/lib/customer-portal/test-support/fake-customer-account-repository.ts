import { randomUUID } from "node:crypto";
import type { CustomerAccountRecord, CustomerAccountRepository, MatchedCustomerRecord } from "../customer-account-repository";

/** In-memory CustomerAccountRepository test double — same intent as fake-scheduling-repository.ts. */
export function createFakeCustomerAccountRepository(
  seed: { customers?: MatchedCustomerRecord[]; accounts?: CustomerAccountRecord[] } = {}
) {
  const customers = [...(seed.customers ?? [])];
  const accountsById = new Map<string, CustomerAccountRecord>();
  for (const a of seed.accounts ?? []) accountsById.set(a.id, a);

  const repo: CustomerAccountRepository = {
    async findAccountBySupabaseUserId(supabaseUserId) {
      for (const a of accountsById.values()) {
        if (a.supabaseUserId === supabaseUserId) return a;
      }
      return null;
    },
    async findAccountByCustomerId(customerId) {
      for (const a of accountsById.values()) {
        if (a.customerId === customerId) return a;
      }
      return null;
    },
    async findCustomersByEmailNormalized(emailNormalized) {
      return customers.filter((c) => c.emailNormalized === emailNormalized);
    },
    async createAccount(input) {
      const id = randomUUID();
      const created: CustomerAccountRecord = { id, supabaseUserId: input.supabaseUserId, customerId: input.customerId, active: true };
      accountsById.set(id, created);
      return created;
    },
  };

  return { repo, state: { customers, accountsById } };
}
