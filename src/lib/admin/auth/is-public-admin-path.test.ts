import { describe, expect, it } from "vitest";
import { isPublicAdminPath } from "./is-public-admin-path";

describe("isPublicAdminPath", () => {
  it("allows /admin/login and its sub-paths", () => {
    expect(isPublicAdminPath("/admin/login")).toBe(true);
    expect(isPublicAdminPath("/admin/login/")).toBe(true);
  });

  it("allows the recovery callback route", () => {
    expect(isPublicAdminPath("/admin/auth/callback")).toBe(true);
  });

  it("keeps /admin/reset-password behind the normal authenticated-session check", () => {
    expect(isPublicAdminPath("/admin/reset-password")).toBe(false);
  });

  it("keeps the real protected admin area behind the normal check", () => {
    expect(isPublicAdminPath("/admin")).toBe(false);
    expect(isPublicAdminPath("/admin/requests")).toBe(false);
    expect(isPublicAdminPath("/admin/cleaners")).toBe(false);
  });

  it("does not match unrelated paths that merely start with /admin/log", () => {
    expect(isPublicAdminPath("/admin/logout-somewhere-else")).toBe(false);
  });
});
