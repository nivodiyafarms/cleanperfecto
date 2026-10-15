import { describe, expect, it, vi } from "vitest";

const rpcMock = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({ rpc: rpcMock }),
}));

const { claimCustomerLoginLinkRequest } = await import("./claim-customer-login-link-request");

describe("claimCustomerLoginLinkRequest", () => {
  it("calls the RPC with the exact email/window/cap and resolves ok on success", async () => {
    rpcMock.mockResolvedValueOnce({ data: { id: "row-1" }, error: null });
    const now = new Date("2026-10-15T00:00:00Z");

    const result = await claimCustomerLoginLinkRequest("customer@example.com", now, 600, 5);

    expect(result).toEqual({ ok: true });
    expect(rpcMock).toHaveBeenCalledWith("claim_customer_login_link_request", {
      p_email_normalized: "customer@example.com",
      p_now: now.toISOString(),
      p_rate_limit_window_seconds: 600,
      p_rate_limit_max: 5,
    });
  });

  it("maps the RPC's 'rate_limited' exception to a typed result", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: "rate_limited" } });

    const result = await claimCustomerLoginLinkRequest("customer@example.com", new Date(), 600, 5);

    expect(result).toEqual({ ok: false, reason: "rate_limited" });
  });

  it("throws (never silently swallows) any other unexpected RPC error", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: "connection reset" } });

    await expect(claimCustomerLoginLinkRequest("customer@example.com", new Date(), 600, 5)).rejects.toThrow("connection reset");
  });
});
