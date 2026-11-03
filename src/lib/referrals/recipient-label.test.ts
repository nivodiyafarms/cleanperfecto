import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  assertRecipientLabelCodeType,
  normalizeRecipientLabel,
  RecipientLabelTooLongError,
  RecipientLabelTypeError,
} from "./recipient-label";

const MIGRATION = "supabase/migrations/20261102120000_add_referral_code_recipient_label.sql";
const APPLY = "docs/apply-referral-recipient-label-production-sql-editor.sql";
const PRECHECK = "docs/referral-recipient-label-production-precheck.sql";
const POSTCHECK = "docs/referral-recipient-label-production-postcheck.sql";

describe("normalizeRecipientLabel", () => {
  it("trims surrounding whitespace", () => {
    expect(normalizeRecipientLabel("  Ada Lovelace  ")).toBe("Ada Lovelace");
  });

  it("turns a blank value into null", () => {
    expect(normalizeRecipientLabel(null)).toBeNull();
    expect(normalizeRecipientLabel(undefined)).toBeNull();
    expect(normalizeRecipientLabel("")).toBeNull();
    expect(normalizeRecipientLabel("   \n\t  ")).toBeNull();
  });

  it("rejects a label longer than 120 characters", () => {
    expect(normalizeRecipientLabel("a".repeat(120))).toBe("a".repeat(120));
    expect(normalizeRecipientLabel(`  ${"a".repeat(120)}  `)).toBe("a".repeat(120));
    expect(() => normalizeRecipientLabel("a".repeat(121))).toThrow(RecipientLabelTooLongError);
    expect(() => normalizeRecipientLabel(`  ${"b".repeat(121)}  `)).toThrow(RecipientLabelTooLongError);
  });
});

describe("assertRecipientLabelCodeType", () => {
  it("rejects a Type A code and allows a Type B code", () => {
    expect(() => assertRecipientLabelCodeType("customer")).toThrow(RecipientLabelTypeError);
    expect(() => assertRecipientLabelCodeType("admin_issued")).not.toThrow();
    expect(() => assertRecipientLabelCodeType("")).toThrow(RecipientLabelTypeError);
  });
});

describe("recipient label migration", () => {
  const sql = readFileSync(MIGRATION, "utf8");

  it("keeps the label off referral_codes and private to service_role", () => {
    expect(sql).not.toMatch(/alter table public\.referral_codes\s+add column recipient_label/i);
    expect(sql).toContain("create table public.referral_code_recipient_labels");
    expect(sql).toContain("alter table public.referral_code_recipient_labels enable row level security");
    expect(sql).toContain("revoke all on public.referral_code_recipient_labels from public, anon, authenticated, service_role");
    expect(sql).toContain("grant select, insert, update on public.referral_code_recipient_labels to service_role");
    expect(sql).not.toMatch(/referral_code_recipient_labels to (anon|authenticated)/);
    expect(sql).not.toMatch(/create policy/i);
  });

  it("adds new functions without replacing create_admin_referral_code", () => {
    expect(sql).not.toMatch(/create\s+or\s+replace\s+function/i);
    expect(sql).not.toMatch(/function public\.create_admin_referral_code\s*\(/i);
    expect(sql).toContain("create function public.create_admin_referral_code_with_label(");
    expect(sql).toContain("create function public.update_admin_referral_code_recipient_label(");
    expect(sql).toMatch(
      /create function public\.create_admin_referral_code_with_label\([\s\S]*?security definer\s+set search_path = public/,
    );
    expect(sql).toMatch(
      /create function public\.update_admin_referral_code_recipient_label\([\s\S]*?security definer\s+set search_path = public/,
    );
    expect(sql).toContain(
      "revoke all on function public.create_admin_referral_code_with_label(uuid, text, text) from public, anon, authenticated",
    );
    expect(sql).toContain(
      "revoke all on function public.update_admin_referral_code_recipient_label(uuid, uuid, text) from public, anon, authenticated",
    );
    expect(sql).toContain("grant execute on function public.create_admin_referral_code_with_label(uuid, text, text) to service_role");
    expect(sql).toContain(
      "grant execute on function public.update_admin_referral_code_recipient_label(uuid, uuid, text) to service_role",
    );
  });

  it("rejects Type A labels and audits the label change without rewriting program rows", () => {
    const updateFn = sql.slice(
      sql.indexOf("create function public.update_admin_referral_code_recipient_label"),
      sql.indexOf("revoke all on function public.create_admin_referral_code_with_label"),
    );
    expect(updateFn).toContain("RECIPIENT_LABEL_TYPE_A_REJECTED");
    expect(updateFn).toContain("v_type is distinct from 'admin_issued'");
    expect(updateFn).toContain("'recipient_label_updated'");
    expect(updateFn).toContain("previous_value");
    expect(updateFn).toContain("new_value");
    expect(updateFn).not.toContain("update public.referral_codes");
    expect(updateFn).not.toContain("update public.referrals");
    expect(updateFn).not.toContain("referral_credits");
    expect(updateFn).not.toContain("referral_redemptions");
    expect(sql).toContain("raise exception 'RECIPIENT_LABEL_TYPE_A_REJECTED'");
    expect(sql).toContain("char_length(v_label) > 120");
  });
});

describe("recipient label stays off customer reads", () => {
  it("does not select the private label from the customer code or summary queries", () => {
    const repo = readFileSync("src/lib/referrals/supabase-referral-repository.ts", "utf8");
    const issueCustomer = repo.slice(repo.indexOf("async issueCustomerCode"), repo.indexOf("async issueAdminCode"));
    const customerSummary = repo.slice(repo.indexOf("async customerSummary"), repo.indexOf("async adminSnapshot"));
    expect(issueCustomer).not.toContain("recipient");
    expect(customerSummary).not.toContain("recipient");
    expect(customerSummary).toContain('.select("code")');
    expect(repo).not.toMatch(/from\("referral_codes"\)\s*\.select\("\*"/);
    const portal = readFileSync("src/app/my/(protected)/rewards/page.tsx", "utf8");
    expect(portal).not.toContain("recipient_label");
    expect(portal).not.toContain("referral_code_recipient_labels");
  });
});

describe("recipient label production scripts", () => {
  it("wraps the migration in one transaction guarded on the previous version", () => {
    const migration = readFileSync(MIGRATION, "utf8").trim();
    const apply = readFileSync(APPLY, "utf8");
    expect(apply).toContain(migration);
    expect(apply).toMatch(/begin;\s+do \$guard\$/);
    expect(apply.trimEnd().endsWith("commit;")).toBe(true);
    expect(apply).toContain("v_latest is distinct from '20261101120000'");
    expect(apply).toContain("referral_code_recipient_labels already exists");
    expect(apply).toContain("referral_codes.recipient_label already exists");
    expect(apply).toContain("values ('20261102120000', 'add_referral_code_recipient_label')");
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
    expect(precheckTail).toContain("20261101120000");
    expect(postcheckTail).toContain("as check_name");
    expect(postcheckTail).toContain("as ok");
    expect(postcheckTail).toContain("20261102120000");
  });
});
