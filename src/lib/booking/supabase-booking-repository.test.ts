import { beforeEach, describe, expect, it, vi } from "vitest";

// Same mocking convention as src/lib/scheduling/supabase-scheduling-repository.test.ts:
// mock the admin client factory, never a real Supabase connection.
const fromMock = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: vi.fn(() => ({ from: fromMock, rpc: vi.fn() })),
}));
vi.mock("@/lib/instant-quote/supabase-repository", () => ({
  createSupabaseInstantQuoteRepository: vi.fn(() => ({})),
}));

const { createSupabaseBookingRepository } = await import("./supabase-booking-repository");

interface QueryResult {
  data: unknown;
  error: { message: string } | null;
}

function makeBuilder(result: QueryResult) {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  builder.select = vi.fn(chain);
  builder.eq = vi.fn(chain);
  builder.maybeSingle = vi.fn(() => Promise.resolve(result));
  return builder;
}

describe("createSupabaseBookingRepository findBookingOrderById", () => {
  beforeEach(() => {
    fromMock.mockReset();
  });

  // Regression: a booking_orders.id is a Postgres `uuid` column. Passing a
  // malformed (non-UUID) id through to .eq() makes Postgres raise "invalid
  // input syntax for type uuid" — a genuine query error that the lookup
  // rethrows, surfacing as an unhandled 500 on /booking/[bookingOrderId]
  // instead of a graceful not-found. A malformed id can never match any
  // row regardless of what's in the table, so it must short-circuit to
  // null before ever reaching the database.
  it("returns null for a malformed (non-UUID) id without querying the database at all", async () => {
    const repo = createSupabaseBookingRepository();
    const result = await repo.findBookingOrderById("launch-verification-probe-nonexistent-id");

    expect(result).toBeNull();
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("queries normally for a validly-shaped UUID that simply doesn't exist, returning null from the real not-found result", async () => {
    const builder = makeBuilder({ data: null, error: null });
    fromMock.mockImplementation((table: string) => {
      if (table === "booking_orders") return builder;
      throw new Error(`unexpected table ${table}`);
    });

    const repo = createSupabaseBookingRepository();
    const result = await repo.findBookingOrderById("00000000-0000-0000-0000-000000000000");

    expect(result).toBeNull();
    expect(fromMock).toHaveBeenCalledWith("booking_orders");
    expect(builder.eq).toHaveBeenCalledWith("id", "00000000-0000-0000-0000-000000000000");
  });

  it("still surfaces a genuine database/server error for a validly-shaped id — never disguised as not-found", async () => {
    const builder = makeBuilder({ data: null, error: { message: "connection terminated unexpectedly" } });
    fromMock.mockImplementation((table: string) => {
      if (table === "booking_orders") return builder;
      throw new Error(`unexpected table ${table}`);
    });

    const repo = createSupabaseBookingRepository();
    await expect(repo.findBookingOrderById("00000000-0000-0000-0000-000000000000")).rejects.toThrow(/connection terminated unexpectedly/);
  });
});
