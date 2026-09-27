import { describe, expect, it } from "vitest";
import { isPublicCustomerPath } from "./is-public-customer-path";

describe("isPublicCustomerPath", () => {
  it("allows /my/login and its sub-paths", () => {
    expect(isPublicCustomerPath("/my/login")).toBe(true);
    expect(isPublicCustomerPath("/my/login/")).toBe(true);
  });

  it("allows the magic-link code-exchange callback route and its real sub-paths", () => {
    expect(isPublicCustomerPath("/my/auth/callback")).toBe(true);
    expect(isPublicCustomerPath("/my/auth/callback/")).toBe(true);
    expect(isPublicCustomerPath("/my/auth/callback/anything")).toBe(true);
  });

  it("allows the token_hash verification confirm route — the Final Total one-click email link", () => {
    expect(isPublicCustomerPath("/my/auth/confirm")).toBe(true);
  });

  it("does NOT allow a callback lookalike — only an exact match or a real /-delimited sub-path, never a bare string prefix", () => {
    expect(isPublicCustomerPath("/my/auth/callback-evil")).toBe(false);
    expect(isPublicCustomerPath("/my/auth/callback-fake")).toBe(false);
    expect(isPublicCustomerPath("/my/auth/callbackAnything")).toBe(false);
  });

  it("does NOT allow a confirm lookalike — /my/auth/confirm is exact-only, with no sub-path form at all", () => {
    expect(isPublicCustomerPath("/my/auth/confirm/anything")).toBe(false);
    expect(isPublicCustomerPath("/my/auth/confirm-fake")).toBe(false);
  });

  it("keeps /my/activate behind the normal authenticated-session check — it is reached only via a redirect AFTER the session is already established", () => {
    expect(isPublicCustomerPath("/my/activate")).toBe(false);
  });

  it("keeps the real protected customer portal behind the normal check", () => {
    expect(isPublicCustomerPath("/my")).toBe(false);
    expect(isPublicCustomerPath("/my/payments")).toBe(false);
    expect(isPublicCustomerPath("/my/cleanings")).toBe(false);
    expect(isPublicCustomerPath("/my/profile")).toBe(false);
    expect(isPublicCustomerPath("/my/invoices")).toBe(false);
    expect(isPublicCustomerPath("/my/receipts")).toBe(false);
    expect(isPublicCustomerPath("/my/package")).toBe(false);
    expect(isPublicCustomerPath("/my/consent")).toBe(false);
  });

  it("does not exempt any other /my/auth/* route via a wildcard — only the exact /my/auth/confirm path and the /my/auth/callback prefix", () => {
    expect(isPublicCustomerPath("/my/auth/confirm-something-else")).toBe(false);
    expect(isPublicCustomerPath("/my/auth/other")).toBe(false);
    expect(isPublicCustomerPath("/my/auth")).toBe(false);
  });

  it("does not match unrelated paths that merely start with /my/log", () => {
    expect(isPublicCustomerPath("/my/logout-somewhere-else")).toBe(false);
  });
});
