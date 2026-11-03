import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const MIGRATION = "supabase/migrations/20261103120000_add_shared_rate_limit.sql";
const APPLY = "docs/apply-shared-rate-limit-production-sql-editor.sql";
const PRECHECK = "docs/shared-rate-limit-production-precheck.sql";
const POSTCHECK = "docs/shared-rate-limit-production-postcheck.sql";
const CLEANUP = "docs/rate-limit-cleanup-cron.sql";

describe("shared rate limit migration", () => {
  const sql = readFileSync(MIGRATION, "utf8");

  it("creates the buckets table with RLS, no policies, service_role only", () => {
    expect(sql).toContain("create table public.rate_limit_buckets");
    expect(sql).toContain("alter table public.rate_limit_buckets enable row level security");
    expect(sql).toContain(
      "revoke all on public.rate_limit_buckets from public, anon, authenticated, service_role"
    );
    expect(sql).toContain("grant select, insert, update, delete on public.rate_limit_buckets to service_role");
    expect(sql).not.toMatch(/create policy/i);
    expect(sql).not.toMatch(/rate_limit_buckets to (anon|authenticated)/);
  });

  it("adds consume_rate_limits without OR REPLACE and locks it to service_role", () => {
    expect(sql).not.toMatch(/create\s+or\s+replace\s+function/i);
    expect(sql).toContain("create function public.consume_rate_limits(");
    expect(sql).toMatch(
      /create function public\.consume_rate_limits\([\s\S]*?security definer\s+set search_path = ''/
    );
    expect(sql).toContain(
      "revoke all on function public.consume_rate_limits(text, integer, integer) from public, anon, authenticated"
    );
    expect(sql).toContain(
      "grant execute on function public.consume_rate_limits(text, integer, integer) to service_role"
    );
    expect(sql).toContain("on conflict (key, window_seconds, window_start)");
    expect(sql).toContain("p_minute_limit + 1");
    expect(sql).toContain("p_hour_limit + 1");
    expect(sql).toContain("'^referral_check:'");
  });

  it("does not modify any pre-existing function", () => {
    expect(sql).not.toMatch(/create\s+or\s+replace/i);
    const created = [...sql.matchAll(/create function public\.([a-z0-9_]+)/gi)].map((m) => m[1]);
    expect(created).toEqual(["consume_rate_limits"]);
  });
});

describe("shared rate limit production scripts", () => {
  it("wraps the migration in one transaction guarded on 20261102120000", () => {
    const migration = readFileSync(MIGRATION, "utf8").trim();
    const apply = readFileSync(APPLY, "utf8");
    expect(apply).toContain(migration);
    expect(apply).toMatch(/begin;\s+do \$guard\$/);
    expect(apply.trimEnd().endsWith("commit;")).toBe(true);
    expect(apply).toContain("v_latest is distinct from '20261102120000'");
    expect(apply).toContain("rate_limit_buckets already exists");
    expect(apply).toContain("consume_rate_limits already exists");
    expect(apply).toContain("values ('20261103120000', 'add_shared_rate_limit')");
  });

  it("keeps the precheck and postcheck read-only, with the checklist last", () => {
    for (const path of [PRECHECK, POSTCHECK]) {
      const withoutComments = readFileSync(path, "utf8").replace(/--[^\n]*/g, "");
      expect(withoutComments).not.toMatch(/^\s*(insert|update|delete|alter|drop|create|grant|revoke|truncate)\b/im);
      expect(withoutComments.trimEnd().endsWith(";")).toBe(true);
    }
    const precheck = readFileSync(PRECHECK, "utf8");
    const postcheck = readFileSync(POSTCHECK, "utf8");
    const precheckTail = precheck.slice(precheck.lastIndexOf("-- checklist"));
    const postcheckTail = postcheck.slice(postcheck.lastIndexOf("-- checklist"));
    expect(precheckTail).toContain("as check_name");
    expect(precheckTail).toContain("as ok");
    expect(precheckTail).toContain("20261102120000");
    expect(postcheckTail).toContain("as check_name");
    expect(postcheckTail).toContain("as ok");
    expect(postcheckTail).toContain("20261103120000");
    expect(postcheckTail).toContain("no raw IP column");
  });

  it("documents cleanup cron separately and does not schedule it in the migration", () => {
    const migration = readFileSync(MIGRATION, "utf8");
    const cleanup = readFileSync(CLEANUP, "utf8");
    expect(migration).not.toContain("cron.schedule");
    expect(cleanup).toContain("NOT applied automatically");
    expect(cleanup).toContain("Owner approval required");
    expect(cleanup).toContain("cleanup-rate-limit-buckets");
    expect(cleanup).toContain("interval '2 days'");
    expect(cleanup).not.toMatch(/cron\.(unschedule|alter)/);
  });
});
