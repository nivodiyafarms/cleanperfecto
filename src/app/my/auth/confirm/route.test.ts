import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const verifyOtpMock = vi.fn();
const createServerClientMock = vi.fn();
let capturedSetAll: ((cookies: { name: string; value: string; options: Record<string, unknown> }[]) => void) | null = null;

// Call history must not leak across tests — several tests below assert
// verifyOtpMock/console.warn were (or weren't) called a specific number of
// times, which is only meaningful per-test, not cumulative across the file.
beforeEach(() => {
  verifyOtpMock.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

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
  it("redirects to /my/login WITH the intended next destination preserved when token_hash is missing — never calls verifyOtp, never strands the customer on a context-free sign-in page", async () => {
    const response = await GET(new NextRequest(confirmUrl({ type: "magiclink", next: "/my/payments?visit=visit-123" })));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost:3000/my/login?next=%2Fmy%2Fpayments%3Fvisit%3Dvisit-123");
    expect(verifyOtpMock).not.toHaveBeenCalled();
  });

  it("redirects to /my/login WITH the intended next destination preserved when type is missing/unsupported — never calls verifyOtp with an unchecked type", async () => {
    const response = await GET(new NextRequest(confirmUrl({ token_hash: "abc123", type: "recovery", next: "/my/payments?visit=visit-123" })));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost:3000/my/login?next=%2Fmy%2Fpayments%3Fvisit%3Dvisit-123");
    expect(verifyOtpMock).not.toHaveBeenCalled();
  });

  it("redirects a missing-token failure for a real payment-visit destination to the branded expired-link page, not the dead-end /my/login", async () => {
    const visitId = "01684d00-6ba3-4978-9660-518defd828c4";
    const response = await GET(new NextRequest(confirmUrl({ type: "magiclink", next: `/my/payments?visit=${visitId}` })));

    expect(response.headers.get("location")).toBe(`http://localhost:3000/my/payment-link-expired?visit=${visitId}`);
    expect(verifyOtpMock).not.toHaveBeenCalled();
  });

  it("redirects a verifyOtp failure for a real payment-visit destination to the branded expired-link page too", async () => {
    const visitId = "01684d00-6ba3-4978-9660-518defd828c4";
    verifyOtpMock.mockResolvedValueOnce({ data: null, error: { message: "Token has expired or is invalid", code: "otp_expired", status: 403 } });

    const response = await GET(new NextRequest(confirmUrl({ token_hash: "stale-token", type: "magiclink", next: `/my/payments?visit=${visitId}` })));

    expect(response.headers.get("location")).toBe(`http://localhost:3000/my/payment-link-expired?visit=${visitId}`);
  });

  it("sanitizes a malicious external next down to /my on the missing-token path too — the failure redirect is just as much an open-redirect surface as the success one", async () => {
    const response = await GET(new NextRequest(confirmUrl({ type: "magiclink", next: "https://evil.example.com/phish" })));

    expect(response.headers.get("location")).toBe("http://localhost:3000/my/login?next=%2Fmy");
  });

  it("calls verifyOtp with the exact token_hash/type from the URL, and redirects to /my/activate with the exact requested next on success", async () => {
    verifyOtpMock.mockResolvedValueOnce({ data: {}, error: null });

    const response = await GET(new NextRequest(confirmUrl({ token_hash: "hashed-token-abc", type: "magiclink", next: "/my/payments?visit=visit-123" })));

    expect(verifyOtpMock).toHaveBeenCalledWith({ token_hash: "hashed-token-abc", type: "magiclink" });
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost:3000/my/activate?next=%2Fmy%2Fpayments%3Fvisit%3Dvisit-123");
  });

  it("redirects to /my/login WITH the intended next destination preserved when verifyOtp fails (expired/already-used token) — never leaves a broken/half-authenticated state, and never strands the customer short of their Final Total", async () => {
    verifyOtpMock.mockResolvedValueOnce({ data: null, error: { message: "Token has expired or is invalid", code: "otp_expired", status: 403 } });

    const response = await GET(new NextRequest(confirmUrl({ token_hash: "stale-token", type: "magiclink", next: "/my/payments?visit=visit-123" })));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost:3000/my/login?next=%2Fmy%2Fpayments%3Fvisit%3Dvisit-123");
  });

  it("sanitizes a malicious external next down to /my when verifyOtp fails too", async () => {
    verifyOtpMock.mockResolvedValueOnce({ data: null, error: { message: "Token has expired or is invalid", code: "otp_expired", status: 403 } });

    const response = await GET(new NextRequest(confirmUrl({ token_hash: "stale-token", type: "magiclink", next: "https://evil.example.com/phish" })));

    expect(response.headers.get("location")).toBe("http://localhost:3000/my/login?next=%2Fmy");
  });

  it("logs only a sanitized code/status on a verifyOtp failure — never the raw error.message, the token_hash, or the request URL", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    verifyOtpMock.mockResolvedValueOnce({
      data: null,
      error: { message: "Token has expired or is invalid for token_hash=super-secret-token-value", code: "otp_expired", status: 403 },
    });

    await GET(new NextRequest(confirmUrl({ token_hash: "super-secret-token-value", type: "magiclink", next: "/my/payments?visit=visit-123" })));

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const loggedArgs = warnSpy.mock.calls[0];
    const loggedText = loggedArgs.join(" ");
    expect(loggedText).toContain("otp_expired");
    expect(loggedText).toContain("403");
    expect(loggedText).not.toContain("super-secret-token-value");
    expect(loggedText).not.toContain("Token has expired or is invalid");
    expect(loggedText).not.toContain("http://localhost:3000/my/auth/confirm");
    warnSpy.mockRestore();
  });

  it("logs a fixed, non-interpolated message for a missing token_hash — distinct from the missing-type and unsupported-type cases below, never echoes the raw query string", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await GET(new NextRequest(confirmUrl({ type: "magiclink", next: "/my/payments?visit=visit-123" })));

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const loggedText = warnSpy.mock.calls[0].join(" ");
    expect(loggedText).toContain("missing token_hash");
    expect(loggedText).not.toContain("visit-123");
    warnSpy.mockRestore();
  });

  it("logs a fixed, non-interpolated message for a missing type — distinct from a missing token_hash", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const response = await GET(new NextRequest(confirmUrl({ token_hash: "abc123", next: "/my/payments?visit=visit-123" })));

    expect(response.headers.get("location")).toBe("http://localhost:3000/my/login?next=%2Fmy%2Fpayments%3Fvisit%3Dvisit-123");
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const loggedText = warnSpy.mock.calls[0].join(" ");
    expect(loggedText).toContain("missing type");
    expect(loggedText).not.toContain("missing token_hash");
    expect(verifyOtpMock).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("logs only a fixed 'unsupported type' label — never the actual type value, even sanitized — for an unsupported-but-real type", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await GET(new NextRequest(confirmUrl({ token_hash: "abc123", type: "recovery", next: "/my/payments?visit=visit-123" })));

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const loggedText = warnSpy.mock.calls[0].join(" ");
    expect(loggedText).toContain("unsupported type");
    expect(loggedText).not.toContain("recovery");
    expect(loggedText).not.toContain("visit-123");
    expect(verifyOtpMock).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("logs the same fixed 'unsupported type' label for a malicious/malformed type value — never echoes it verbatim", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await GET(new NextRequest(confirmUrl({ token_hash: "abc123", type: "<script>alert(1)</script>", next: "/my/payments?visit=visit-123" })));

    const loggedText = warnSpy.mock.calls[0].join(" ");
    expect(loggedText).toContain("unsupported type");
    expect(loggedText).not.toContain("<script>");
    warnSpy.mockRestore();
  });

  it("accepts type=signup — the real-world gap found via service_visit 0a4ef785-4704-4eee-9643-c69c0f773c45: a first-time customer's generateLink({type:'magiclink'}) call legitimately returns verification_type 'signup', and this route must call verifyOtp with it rather than rejecting it as unsupported", async () => {
    verifyOtpMock.mockResolvedValueOnce({ data: {}, error: null });

    const response = await GET(new NextRequest(confirmUrl({ token_hash: "hashed-token-abc", type: "signup", next: "/my/payments?visit=visit-123" })));

    expect(verifyOtpMock).toHaveBeenCalledWith({ token_hash: "hashed-token-abc", type: "signup" });
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost:3000/my/activate?next=%2Fmy%2Fpayments%3Fvisit%3Dvisit-123");
  });

  it("falls back to a safe 'unknown_error_code' label when verifyOtp's error carries no recognizable code — the failure is still logged, just without a fabricated reason", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    verifyOtpMock.mockResolvedValueOnce({ data: null, error: { message: "some unexpected shape" } });

    await GET(new NextRequest(confirmUrl({ token_hash: "stale-token", type: "magiclink", next: "/my/payments?visit=visit-123" })));

    const loggedText = warnSpy.mock.calls[0].join(" ");
    expect(loggedText).toContain("unknown_error_code");
    expect(loggedText).toContain("unknown"); // status
    expect(loggedText).not.toContain("some unexpected shape");
    warnSpy.mockRestore();
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
