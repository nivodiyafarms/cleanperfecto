import { describe, expect, it } from "vitest";
import type {
  CustomerContactPatch,
  CustomerLookupRepository,
  CustomerRecord,
  NewCustomerInput,
} from "./customer-repository";
import { resolveCustomer, type ResolveCustomerInput } from "./resolve-customer";

class FakeCustomerRepository implements CustomerLookupRepository {
  customers: CustomerRecord[] = [];
  private nextId = 1;
  createCalls: NewCustomerInput[] = [];
  updateCalls: { customerId: string; patch: CustomerContactPatch }[] = [];

  async findByEmailNormalized(emailNormalized: string): Promise<CustomerRecord[]> {
    return this.customers.filter((customer) => customer.emailNormalized === emailNormalized);
  }

  async findByPhoneNormalized(phoneNormalized: string): Promise<CustomerRecord[]> {
    return this.customers.filter((customer) => customer.phoneNormalized === phoneNormalized);
  }

  async createCustomer(input: NewCustomerInput): Promise<CustomerRecord> {
    this.createCalls.push(input);
    const customer: CustomerRecord = { id: `customer-${this.nextId++}`, ...input };
    this.customers.push(customer);
    return customer;
  }

  async updateCustomerContact(customerId: string, patch: CustomerContactPatch): Promise<void> {
    this.updateCalls.push({ customerId, patch });
  }
}

function input(overrides: Partial<ResolveCustomerInput> = {}): ResolveCustomerInput {
  return {
    name: "Jane Customer",
    email: "jane@example.com",
    emailNormalized: "jane@example.com",
    phone: "+14695550100",
    phoneNormalized: "+14695550100",
    ...overrides,
  };
}

describe("resolveCustomer", () => {
  it("Case A: normalized email and phone both match the same customer -> reuse", async () => {
    const repo = new FakeCustomerRepository();
    const existing = await repo.createCustomer({
      name: "Jane",
      email: "jane@example.com",
      emailNormalized: "jane@example.com",
      phone: "+14695550100",
      phoneNormalized: "+14695550100",
    });

    const result = await resolveCustomer(input(), repo);
    expect(result).toEqual({ outcome: "matched", customer: existing, matchedBy: "email_and_phone" });
  });

  it("Case B: only normalized email matches -> reuse", async () => {
    const repo = new FakeCustomerRepository();
    const existing = await repo.createCustomer({
      name: "Jane",
      email: "jane@example.com",
      emailNormalized: "jane@example.com",
      phone: null,
      phoneNormalized: null,
    });

    const result = await resolveCustomer(input({ phone: "+14695559999", phoneNormalized: "+14695559999" }), repo);
    expect(result).toEqual({ outcome: "matched", customer: existing, matchedBy: "email_only" });
  });

  it("Case C: only normalized phone matches -> reuse", async () => {
    const repo = new FakeCustomerRepository();
    const existing = await repo.createCustomer({
      name: "Jane",
      email: null,
      emailNormalized: null,
      phone: "+14695550100",
      phoneNormalized: "+14695550100",
    });

    const result = await resolveCustomer(
      input({ email: "different@example.com", emailNormalized: "different@example.com" }),
      repo
    );
    expect(result).toEqual({ outcome: "matched", customer: existing, matchedBy: "phone_only" });
  });

  it("Case D: neither matches -> creates a new customer", async () => {
    const repo = new FakeCustomerRepository();

    const result = await resolveCustomer(input(), repo);
    expect(result.outcome).toBe("created");
    expect(repo.createCalls).toHaveLength(1);
    if (result.outcome === "created") {
      expect(result.customer.emailNormalized).toBe("jane@example.com");
    }
  });

  it("Case E: normalized email matches Customer A and normalized phone matches Customer B -> conflict, no merge, no pick", async () => {
    const repo = new FakeCustomerRepository();
    const customerA = await repo.createCustomer({
      name: "Customer A",
      email: "jane@example.com",
      emailNormalized: "jane@example.com",
      phone: "+14695551111",
      phoneNormalized: "+14695551111",
    });
    const customerB = await repo.createCustomer({
      name: "Customer B",
      email: "other@example.com",
      emailNormalized: "other@example.com",
      phone: "+14695550100",
      phoneNormalized: "+14695550100",
    });

    repo.createCalls = []; // clear the two setup-time creations before asserting resolveCustomer itself creates nothing
    const result = await resolveCustomer(input(), repo);
    expect(result).toEqual({
      outcome: "conflict",
      reason: "EMAIL_AND_PHONE_MATCH_DIFFERENT_CUSTOMERS",
      conflictingCustomerIds: [customerA.id, customerB.id],
    });
    expect(repo.createCalls).toHaveLength(0);
  });

  it("does not create or update anything when a conflict is detected", async () => {
    const repo = new FakeCustomerRepository();
    await repo.createCustomer({
      name: "Customer A",
      email: "jane@example.com",
      emailNormalized: "jane@example.com",
      phone: "+14695551111",
      phoneNormalized: "+14695551111",
    });
    await repo.createCustomer({
      name: "Customer B",
      email: "other@example.com",
      emailNormalized: "other@example.com",
      phone: "+14695550100",
      phoneNormalized: "+14695550100",
    });

    repo.createCalls = []; // clear the two setup-time creations before asserting resolveCustomer itself creates nothing
    await resolveCustomer(input(), repo);
    expect(repo.createCalls).toHaveLength(0);
    expect(repo.updateCalls).toHaveLength(0);
  });

  it("uses only the supplied identifier when one contact method is omitted", async () => {
    const repo = new FakeCustomerRepository();
    const existing = await repo.createCustomer({
      name: "Jane",
      email: "jane@example.com",
      emailNormalized: "jane@example.com",
      phone: null,
      phoneNormalized: null,
    });

    const result = await resolveCustomer(input({ phone: null, phoneNormalized: null }), repo);
    expect(result).toEqual({ outcome: "matched", customer: existing, matchedBy: "email_only" });
  });

  it("flags multiple customers sharing the same normalized email as a conflict rather than picking one", async () => {
    const repo = new FakeCustomerRepository();
    const dupeA = await repo.createCustomer({
      name: "Dupe A",
      email: "jane@example.com",
      emailNormalized: "jane@example.com",
      phone: null,
      phoneNormalized: null,
    });
    const dupeB = await repo.createCustomer({
      name: "Dupe B",
      email: "jane@example.com",
      emailNormalized: "jane@example.com",
      phone: null,
      phoneNormalized: null,
    });

    const result = await resolveCustomer(input({ phone: null, phoneNormalized: null }), repo);
    expect(result).toEqual({
      outcome: "conflict",
      reason: "MULTIPLE_CUSTOMERS_SHARE_EMAIL",
      conflictingCustomerIds: [dupeA.id, dupeB.id],
    });
  });
});
