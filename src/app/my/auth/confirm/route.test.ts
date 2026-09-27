import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const verifyOtpMock = vi.fn();
const createServerClientMock = vi.fn();
let capturedSetAll: ((cookies: { name: string; value: string; options: Record<string, unknown> }[]) => void) | null = null;

vi.mock("@supabase/ssr", () => ({
  createServerClient: (...args: unknown[]) => {
    createServerClientMock(...args);
    const cookiesConfig = args[2] as { cookies: { setAll: typeof capturedSetAll } };
    capturedSetAll = cookiesConfig.cookies.setAll;
    return { auth: { verifyOtp: verifyOtpMock } };
  },
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({ getAll: () => [] }),
}));

vi.mock("@/lib/supabase/env", () => ({
  getSupabasePublicConfig: () => ({ supabaseUrl: "https://project.supabase.co", supabasePublishableKey: "pk_test_fixture" }),
}));

const { GET } = await import("./route");

function confirmUrl(params: Record<string, string>): string {
  const url = new URL("http://localhost:3000/my/auth/confirm");
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}

describe("GET /my/auth/confirm", () => {
  it("redirects to /my/login when token_hash is missing — never calls verifyOtp", async () => {
    const response = await GET(new NextRequest(confirmUrl({ type: "magiclink", next: "/my/payments?visit=visit-123" })));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost:3000/my/login");
    expect(verifyOtpMock).not.toHaveBeenCalled();
  });

  it("redirects to /my/login when type is missing/unsupported — never calls verifyOtp with an unchecked type", async () => {
    const response = await GET(new NextRequest(confirmUrl({ token_hash: "abc123", type: "recovery", next: "/my/payments?visit=visit-123" })));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost:3000/my/login");
    expect(verifyOtpMock).not.toHaveBeenCalled();
  });

  it("calls verifyOtp with the exact token_hash/type from the URL, and redirects to /my/activate with the exact requested next on success", async () => {
    verifyOtpMock.mockResolvedValueOnce({ data: {}, error: null });

    const response = await GET(new NextRequest(confirmUrl({ token_hash: "hashed-token-abc", type: "magiclink", next: "/my/payments?visit=visit-123" })));

    expect(verifyOtpMock).toHaveBeenCalledWith({ token_hash: "hashed-token-abc", type: "magiclink" });
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost:3000/my/activate?next=%2Fmy%2Fpayments%3Fvisit%3Dvisit-123");
  });

  it("redirects to /my/login when verifyOtp fails (expired/already-used token) — never leaves a broken/half-authenticated state", async () => {
    verifyOtpMock.mockResolvedValueOnce({ data: null, error: { message: "Token has expired or is invalid" } });

    const response = await GET(new NextRequest(confirmUrl({ token_hash: "stale-token", type: "magiclink", next: "/my/payments?visit=visit-123" })));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost:3000/my/login");
  });

  it("sanitizes a malicious external next URL down to /my before redirecting — never an open redirect", async () => {
    verifyOtpMock.mockResolvedValueOnce({ data: {}, error: null });

    const response = await GET(new NextRequest(confirmUrl({ token_hash: "hashed-token-abc", type: "magiclink", next: "https://evil.example.com/phish" })));

    expect(response.headers.get("location")).toBe("http://localhost:3000/my/activate?next=%2Fmy");
  });

  it("writes the session cookies Supabase's verifyOtp establishes onto the redirect response, before redirecting", async () => {
    verifyOtpMock.mockImplementationOnce(async () => {
      capturedSetAll?.([{ name: "sb-access-token", value: "session-cookie-value", options: { path: "/" } }]);
      return { data: {}, error: null };
    });

    const response = await GET(new NextRequest(confirmUrl({ token_hash: "hashed-token-abc", type: "magiclink", next: "/my/payments?visit=visit-123" })));

    expect(response.cookies.get("sb-access-token")?.value).toBe("session-cookie-value");
  });

  it("sets Cache-Control: private, no-store and Referrer-Policy: no-referrer on a successful redirect — this response carries Set-Cookie and must never be cached or leak the token_hash via Referer", async () => {
    verifyOtpMock.mockResolvedValueOnce({ data: {}, error: null });

    const response = await GET(new NextRequest(confirmUrl({ token_hash: "hashed-token-abc", type: "magiclink", next: "/my/payments?visit=visit-123" })));

    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
  });

  it("sets the same two headers on every failure redirect too — missing token_hash, unsupported type, and a failed verifyOtp", async () => {
    const missingToken = await GET(new NextRequest(confirmUrl({ type: "magiclink", next: "/my/payments?visit=visit-123" })));
    expect(missingToken.headers.get("Cache-Control")).toBe("private, no-store");
    expect(missingToken.headers.get("Referrer-Policy")).toBe("no-referrer");

    const unsupportedType = await GET(new NextRequest(confirmUrl({ token_hash: "abc123", type: "recovery", next: "/my/payments?visit=visit-123" })));
    expect(unsupportedType.headers.get("Cache-Control")).toBe("private, no-store");
    expect(unsupportedType.headers.get("Referrer-Policy")).toBe("no-referrer");

    verifyOtpMock.mockResolvedValueOnce({ data: null, error: { message: "Token has expired or is invalid" } });
    const verifyFailed = await GET(new NextRequest(confirmUrl({ token_hash: "stale-token", type: "magiclink", next: "/my/payments?visit=visit-123" })));
    expect(verifyFailed.headers.get("Cache-Control")).toBe("private, no-store");
    expect(verifyFailed.headers.get("Referrer-Policy")).toBe("no-referrer");
  });
});
