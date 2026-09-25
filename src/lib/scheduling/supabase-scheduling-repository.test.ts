import { beforeEach, describe, expect, it, vi } from "vitest";

// Same mocking convention as src/lib/instant-quote/supabase-repository.test.ts:
// mock the admin client factory, never a real Supabase connection.
const fromMock = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: vi.fn(() => ({ from: fromMock })),
}));

const { createSupabaseSchedulingRepository } = await import("./supabase-scheduling-repository");

interface QueryResult {
  data: unknown;
  error: { message: string } | null;
}

function makeBuilder(result: QueryResult) {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  builder.select = vi.fn(chain);
  builder.eq = vi.fn(chain);
  builder.neq = vi.fn(chain);
  builder.gte = vi.fn(chain);
  builder.lt = vi.fn(chain);
  builder.then = (resolve: (value: QueryResult) => unknown, reject?: (reason: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return builder;
}

describe("createSupabaseSchedulingRepository listActiveAssignmentsInRange", () => {
  beforeEach(() => {
    fromMock.mockReset();
  });

  // Regression for a real E2E-discovered bug: this used to filter
  // service_visits.status = 'scheduled', so a cleaner's still-active
  // (unassigned_at IS NULL) assignment on a visit that had since progressed
  // to 'work_finished' or 'completed' was invisible to the availability
  // read path — the admin UI showed the cleaner as free, then
  // set_service_visit_schedule()'s EXCLUDE constraint correctly rejected
  // the write as a double-booking. unassigned_at IS NULL is the sole
  // source of truth (see the service_visit_assignments table comment in
  // 20260822090500_enable_btree_gist_and_create_service_visit_assignments.sql) —
  // status must never gate this query.
  it("includes active assignments regardless of the parent visit's status", async () => {
    const builder = makeBuilder({
      data: [
        {
          confirmed_start_at: "2026-09-25T15:00:00.000Z",
          confirmed_end_at: "2026-09-25T18:00:00.000Z",
          turnaround_buffer_minutes: 60,
          service_visit_assignments: [{ cleaner_id: "cleaner-completed", unassigned_at: null }],
        },
        {
          confirmed_start_at: "2026-09-25T20:00:00.000Z",
          confirmed_end_at: "2026-09-25T21:00:00.000Z",
          turnaround_buffer_minutes: 60,
          service_visit_assignments: [{ cleaner_id: "cleaner-scheduled", unassigned_at: null }],
        },
      ],
      error: null,
    });
    fromMock.mockImplementation((table: string) => {
      if (table === "service_visits") return builder;
      throw new Error(`unexpected table ${table}`);
    });

    const repo = createSupabaseSchedulingRepository();
    const result = await repo.listActiveAssignmentsInRange(new Date("2026-09-25T00:00:00.000Z"), new Date("2026-09-26T00:00:00.000Z"));

    expect(result.map((r) => r.cleanerId).sort()).toEqual(["cleaner-completed", "cleaner-scheduled"]);
    expect(builder.eq).not.toHaveBeenCalledWith("status", "scheduled");
  });

  it("still excludes assignments already released via unassigned_at", async () => {
    const builder = makeBuilder({
      data: [
        {
          confirmed_start_at: "2026-09-25T15:00:00.000Z",
          confirmed_end_at: "2026-09-25T18:00:00.000Z",
          turnaround_buffer_minutes: 60,
          service_visit_assignments: [{ cleaner_id: "cleaner-cancelled", unassigned_at: "2026-09-20T00:00:00.000Z" }],
        },
      ],
      error: null,
    });
    fromMock.mockImplementation((table: string) => {
      if (table === "service_visits") return builder;
      throw new Error(`unexpected table ${table}`);
    });

    const repo = createSupabaseSchedulingRepository();
    const result = await repo.listActiveAssignmentsInRange(new Date("2026-09-25T00:00:00.000Z"), new Date("2026-09-26T00:00:00.000Z"));

    expect(result).toEqual([]);
  });
});
