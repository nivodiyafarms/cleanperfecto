import { describe, expect, it } from "vitest";
import { resolveAdminSession } from "./require-admin";

describe("resolveAdminSession", () => {
  it("is unauthenticated when there is no supabase user id", () => {
    const result = resolveAdminSession(null, () => ({ id: "admin-1", role: "admin" }));
    expect(result.status).toBe("unauthenticated");
  });

  it("is unauthorized when the supabase user has no admin_users row", () => {
    const result = resolveAdminSession("user-1", () => null);
    expect(result.status).toBe("unauthorized");
  });

  it("is unauthorized when the lookup only returns inactive admins (lookup itself filters active=true)", () => {
    // The real lookup (findActiveAdminUserBySupabaseUserId) filters
    // active=true in its query — an inactive admin_users row simply never
    // reaches this function, which is exactly what we're modeling here by
    // returning null.
    const result = resolveAdminSession("user-2", () => null);
    expect(result.status).toBe("unauthorized");
  });

  it("is authorized when an active admin_users row is found, carrying its id/role through", () => {
    const result = resolveAdminSession("user-3", () => ({ id: "admin-99", role: "admin" }));
    expect(result).toEqual({
      status: "authorized",
      session: { adminUserId: "admin-99", supabaseUserId: "user-3", role: "admin" },
    });
  });

  it("only ever looks up the exact supabase user id it was given", () => {
    let queriedId: string | null = null;
    resolveAdminSession("user-4", (id) => {
      queriedId = id;
      return { id: "admin-4", role: "admin" };
    });
    expect(queriedId).toBe("user-4");
  });
});
