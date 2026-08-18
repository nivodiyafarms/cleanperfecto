import { beforeEach, describe, expect, it, vi } from "vitest";

// Same mocking convention as src/lib/submitQuoteRequest.test.ts: mock the
// admin client factory, never a real Supabase connection.
const fromMock = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: vi.fn(() => ({ from: fromMock })),
}));

const { createSupabaseInstantQuoteRepository } = await import("./supabase-repository");

interface QueryResult {
  data: unknown;
  error: { message: string } | null;
}

function makeBuilder(result: QueryResult) {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  builder.select = vi.fn(chain);
  builder.eq = vi.fn(chain);
  builder.in = vi.fn(chain);
  builder.limit = vi.fn(chain);
  builder.insert = vi.fn(chain);
  builder.update = vi.fn(chain);
  builder.single = vi.fn(() => Promise.resolve(result));
  builder.then = (resolve: (value: QueryResult) => unknown, reject?: (reason: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return builder;
}

describe("createSupabaseInstantQuoteRepository", () => {
  beforeEach(() => {
    fromMock.mockReset();
  });

  it("insertQuoteRequest never calls .select() — quote_requests only grants service_role INSERT, not SELECT", async () => {
    const insertMock = vi.fn(() => ({ then: (resolve: (v: QueryResult) => unknown) => Promise.resolve({ data: null, error: null }).then(resolve) }));
    const selectMock = vi.fn(() => {
      throw new Error("select() must never be called on quote_requests after insert()");
    });
    fromMock.mockImplementation((table: string) => {
      if (table === "quote_requests") {
        return { insert: insertMock, select: selectMock };
      }
      throw new Error(`unexpected table ${table}`);
    });

    const repo = createSupabaseInstantQuoteRepository();
    const row = { id: "quote-1" } as never;
    const result = await repo.insertQuoteRequest(row);

    expect(result).toEqual({ ok: true });
    expect(insertMock).toHaveBeenCalledWith(row);
    expect(selectMock).not.toHaveBeenCalled();
  });

  it("insertQuoteRequest surfaces a Supabase error as a typed failure", async () => {
    fromMock.mockImplementation((table: string) => {
      if (table === "quote_requests") {
        return { insert: vi.fn(() => Promise.resolve({ data: null, error: { message: "insert failed" } })) };
      }
      throw new Error(`unexpected table ${table}`);
    });

    const repo = createSupabaseInstantQuoteRepository();
    const result = await repo.insertQuoteRequest({ id: "quote-1" } as never);
    expect(result).toEqual({ ok: false, error: "insert failed" });
  });

  it("findByEmailNormalized queries customers filtered by email_normalized and maps rows", async () => {
    const builder = makeBuilder({
      data: [
        { id: "c1", name: "Jane", email: "jane@example.com", email_normalized: "jane@example.com", phone: null, phone_normalized: null },
      ],
      error: null,
    });
    fromMock.mockImplementation((table: string) => {
      if (table === "customers") return builder;
      throw new Error(`unexpected table ${table}`);
    });

    const repo = createSupabaseInstantQuoteRepository();
    const result = await repo.findByEmailNormalized("jane@example.com");

    expect(builder.select).toHaveBeenCalled();
    expect(builder.eq).toHaveBeenCalledWith("email_normalized", "jane@example.com");
    expect(result).toEqual([
      { id: "c1", name: "Jane", email: "jane@example.com", emailNormalized: "jane@example.com", phone: null, phoneNormalized: null },
    ]);
  });

  it("createCustomer inserts into customers and selects the created row back (customers grants service_role SELECT)", async () => {
    const builder = makeBuilder({
      data: { id: "c1", name: "Jane", email: "jane@example.com", email_normalized: "jane@example.com", phone: null, phone_normalized: null },
      error: null,
    });
    fromMock.mockImplementation((table: string) => {
      if (table === "customers") return builder;
      throw new Error(`unexpected table ${table}`);
    });

    const repo = createSupabaseInstantQuoteRepository();
    const created = await repo.createCustomer({
      name: "Jane",
      email: "jane@example.com",
      emailNormalized: "jane@example.com",
      phone: null,
      phoneNormalized: null,
    });

    expect(builder.insert).toHaveBeenCalledWith({
      name: "Jane",
      email: "jane@example.com",
      email_normalized: "jane@example.com",
      phone: null,
      phone_normalized: null,
    });
    expect(created.id).toBe("c1");
  });

  it("hasCompletedVisitByEmail joins through customers, then checks service_visits by customer_id", async () => {
    const customersBuilder = makeBuilder({ data: [{ id: "c1" }, { id: "c2" }], error: null });
    const visitsBuilder = makeBuilder({ data: [{ id: "v1" }], error: null });
    fromMock.mockImplementation((table: string) => {
      if (table === "customers") return customersBuilder;
      if (table === "service_visits") return visitsBuilder;
      throw new Error(`unexpected table ${table}`);
    });

    const repo = createSupabaseInstantQuoteRepository();
    const result = await repo.hasCompletedVisitByEmail("jane@example.com");

    expect(customersBuilder.eq).toHaveBeenCalledWith("email_normalized", "jane@example.com");
    expect(visitsBuilder.eq).toHaveBeenCalledWith("status", "completed");
    expect(visitsBuilder.in).toHaveBeenCalledWith("customer_id", ["c1", "c2"]);
    expect(result).toBe(true);
  });

  it("hasCompletedVisitByEmail short-circuits to false without querying service_visits when no customer matches", async () => {
    const customersBuilder = makeBuilder({ data: [], error: null });
    const visitsFrom = vi.fn();
    fromMock.mockImplementation((table: string) => {
      if (table === "customers") return customersBuilder;
      if (table === "service_visits") return visitsFrom();
      throw new Error(`unexpected table ${table}`);
    });

    const repo = createSupabaseInstantQuoteRepository();
    const result = await repo.hasCompletedVisitByEmail("nobody@example.com");

    expect(result).toBe(false);
    expect(visitsFrom).not.toHaveBeenCalled();
  });

  it("hasCompletedVisitByAddress queries service_visits directly by service_address_identity, no customers join", async () => {
    const visitsBuilder = makeBuilder({ data: [{ id: "v1" }], error: null });
    const customersFrom = vi.fn();
    fromMock.mockImplementation((table: string) => {
      if (table === "service_visits") return visitsBuilder;
      if (table === "customers") return customersFrom();
      throw new Error(`unexpected table ${table}`);
    });

    const repo = createSupabaseInstantQuoteRepository();
    const result = await repo.hasCompletedVisitByAddress("75056|123 MAIN ST|APT 4B");

    expect(visitsBuilder.eq).toHaveBeenCalledWith("status", "completed");
    expect(visitsBuilder.eq).toHaveBeenCalledWith("service_address_identity", "75056|123 MAIN ST|APT 4B");
    expect(customersFrom).not.toHaveBeenCalled();
    expect(result).toBe(true);
  });

  it("updateCustomerContact is a no-op (no supabase call) when the patch is empty", async () => {
    const repo = createSupabaseInstantQuoteRepository();
    await repo.updateCustomerContact("c1", {});
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("updateCustomerContact maps camelCase patch keys to snake_case columns", async () => {
    const builder = makeBuilder({ data: null, error: null });
    fromMock.mockImplementation((table: string) => {
      if (table === "customers") return builder;
      throw new Error(`unexpected table ${table}`);
    });

    const repo = createSupabaseInstantQuoteRepository();
    await repo.updateCustomerContact("c1", { emailNormalized: "new@example.com", phone: "469-555-0100" });

    expect(builder.update).toHaveBeenCalledWith({
      email_normalized: "new@example.com",
      phone: "469-555-0100",
    });
    expect(builder.eq).toHaveBeenCalledWith("id", "c1");
  });
});
