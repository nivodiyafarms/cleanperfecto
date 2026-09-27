import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const getUserMock = vi.fn();

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({ auth: { getUser: getUserMock } }),
}));

vi.mock("@/lib/supabase/env", () => ({
  getSupabasePublicConfig: () => ({ supabaseUrl: "https://project.supabase.co", supabasePublishableKey: "pk_test_fixture" }),
}));

const { proxy } = await import("./proxy");

function makeRequest(path: string): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`);
}

describe("proxy — customer portal auth guard", () => {
  beforeEach(() => {
    getUserMock.mockReset();
    getUserMock.mockResolvedValue({ data: { user: null } }); // unauthenticated by default
  });

  it("does NOT redirect an unauthenticated request to /my/auth/confirm — the route itself authenticates the one-time token_hash", async () => {
    const response = await proxy(makeRequest("/my/auth/confirm?token_hash=abc123&type=magiclink&next=%2Fmy%2Fpayments%3Fvisit%3Dvisit-1"));

    expect(response.status).not.toBe(307);
    expect(response.headers.get("location")).toBeNull();
    // The path-allowlist short-circuits before Supabase is ever consulted.
    expect(getUserMock).not.toHaveBeenCalled();
  });

  it("still redirects an unauthenticated request to a genuinely protected page (/my/payments) to /my/login", async () => {
    const response = await proxy(makeRequest("/my/payments?visit=visit-1"));

    expect(response.status).toBe(307);
    const location = new URL(response.headers.get("location")!);
    expect(location.pathname).toBe("/my/login");
    expect(location.searchParams.get("next")).toBe("/my/payments?visit=visit-1");
  });

  it("still redirects an unauthenticated request to /my/activate — it is reached only via a post-authentication redirect, never a direct unauthenticated entry point", async () => {
    const response = await proxy(makeRequest("/my/activate?next=%2Fmy%2Fpayments"));

    expect(response.status).toBe(307);
    const location = new URL(response.headers.get("location")!);
    expect(location.pathname).toBe("/my/login");
  });

  it("/my/login itself remains public (no redirect loop)", async () => {
    const response = await proxy(makeRequest("/my/login"));

    expect(response.status).not.toBe(307);
    expect(response.headers.get("location")).toBeNull();
    expect(getUserMock).not.toHaveBeenCalled();
  });

  it("/my/auth/callback remains public, unaffected by the /my/auth/confirm addition", async () => {
    const response = await proxy(makeRequest("/my/auth/callback?code=abc&next=%2Fmy%2Fpayments"));

    expect(response.status).not.toBe(307);
    expect(response.headers.get("location")).toBeNull();
    expect(getUserMock).not.toHaveBeenCalled();
  });

  it("does not accidentally exempt an unrelated /my/auth/* route via a wildcard", async () => {
    const response = await proxy(makeRequest("/my/auth/some-other-route"));

    expect(response.status).toBe(307);
    const location = new URL(response.headers.get("location")!);
    expect(location.pathname).toBe("/my/login");
  });

  it("an authenticated request to a protected page passes through without redirecting", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });

    const response = await proxy(makeRequest("/my/payments?visit=visit-1"));

    expect(response.status).not.toBe(307);
    expect(response.headers.get("location")).toBeNull();
  });
});
