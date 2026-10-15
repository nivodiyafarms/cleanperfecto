import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const exchangeCodeForSessionMock = vi.fn();
let cookieJar: Record<string, string> = {};

beforeEach(() => {
  exchangeCodeForSessionMock.mockClear();
  cookieJar = {};
});

afterEach(() => {
  vi.restoreAllMocks();
});

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({ auth: { exchangeCodeForSession: exchangeCodeForSessionMock } }),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    getAll: () => Object.entries(cookieJar).map(([name, value]) => ({ name, value })),
    get: (name: string) => (name in cookieJar ? { name, value: cookieJar[name] } : undefined),
  }),
}));

vi.mock("@/lib/supabase/env", () => ({
  getSupabasePublicConfig: () => ({ supabaseUrl: "https://project.supabase.co", supabasePublishableKey: "pk_test_fixture" }),
}));

const { GET } = await import("./route");

function callbackUrl(params: Record<string, string>): string {
  const url = new URL("http://localhost:3000/my/auth/callback");
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}

describe("GET /my/auth/callback", () => {
  it("redirects to /my/login when no code is present — never calls exchangeCodeForSession", async () => {
    const response = await GET(new NextRequest(callbackUrl({})));

    expect(response.headers.get("location")).toBe("http://localhost:3000/my/login");
    expect(exchangeCodeForSessionMock).not.toHaveBeenCalled();
  });

  it("falls back to the cleanperfecto_login_next cookie when emailRedirectTo carried no ?next= query — this is the actual fix: emailRedirectTo is now a bare, fixed URL (never a dynamic ?next= Supabase's Redirect URLs allowlist could reject and silently fall back to the Site URL/public homepage for), so the real destination has to come from here instead", async () => {
    exchangeCodeForSessionMock.mockResolvedValueOnce({ error: null });
    cookieJar.cleanperfecto_login_next = encodeURIComponent("/my/payments?visit=visit-123");

    const response = await GET(new NextRequest(callbackUrl({ code: "abc123" })));

    expect(response.headers.get("location")).toBe("http://localhost:3000/my/activate?next=%2Fmy%2Fpayments%3Fvisit%3Dvisit-123");
  });

  it("prefers an explicit ?next= query param over the cookie when both are present", async () => {
    exchangeCodeForSessionMock.mockResolvedValueOnce({ error: null });
    cookieJar.cleanperfecto_login_next = encodeURIComponent("/my/cleanings");

    const response = await GET(new NextRequest(callbackUrl({ code: "abc123", next: "/my/invoices" })));

    expect(response.headers.get("location")).toBe("http://localhost:3000/my/activate?next=%2Fmy%2Finvoices");
  });

  it("defaults to the dashboard (/my), never the public homepage, when neither a query next nor the cookie is present", async () => {
    exchangeCodeForSessionMock.mockResolvedValueOnce({ error: null });

    const response = await GET(new NextRequest(callbackUrl({ code: "abc123" })));

    expect(response.headers.get("location")).toBe("http://localhost:3000/my/activate?next=%2Fmy");
  });

  it("sanitizes a malicious external value in the cookie down to /my — the cookie is just as much an open-redirect surface as the query string was", async () => {
    exchangeCodeForSessionMock.mockResolvedValueOnce({ error: null });
    cookieJar.cleanperfecto_login_next = encodeURIComponent("https://evil.example.com/phish");

    const response = await GET(new NextRequest(callbackUrl({ code: "abc123" })));

    expect(response.headers.get("location")).toBe("http://localhost:3000/my/activate?next=%2Fmy");
  });

  it("redirects to /my/login, preserving no destination, when exchangeCodeForSession fails", async () => {
    exchangeCodeForSessionMock.mockResolvedValueOnce({ error: { message: "invalid grant" } });

    const response = await GET(new NextRequest(callbackUrl({ code: "stale-code" })));

    expect(response.headers.get("location")).toBe("http://localhost:3000/my/login");
  });

  it("clears the login-next cookie on every response path — missing code, success, and exchange failure — so a stale value can never leak into a later login", async () => {
    const missingCode = await GET(new NextRequest(callbackUrl({})));
    expect(missingCode.cookies.get("cleanperfecto_login_next")?.value).toBe("");

    exchangeCodeForSessionMock.mockResolvedValueOnce({ error: null });
    const success = await GET(new NextRequest(callbackUrl({ code: "abc123" })));
    expect(success.cookies.get("cleanperfecto_login_next")?.value).toBe("");

    exchangeCodeForSessionMock.mockResolvedValueOnce({ error: { message: "invalid grant" } });
    const failure = await GET(new NextRequest(callbackUrl({ code: "stale-code" })));
    expect(failure.cookies.get("cleanperfecto_login_next")?.value).toBe("");
  });
});
