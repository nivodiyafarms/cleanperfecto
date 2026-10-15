import { describe, expect, it, vi } from "vitest";
import { createFakeCustomerAuthLinkGenerator } from "../test-support/fake-customer-auth-link-generator";
import { createFakeEmailSender } from "@/lib/notifications/test-support/fake-email-sender";
import type { ClaimCustomerLoginLinkRequestResult } from "../claim-customer-login-link-request";

let fakeAuthLink: ReturnType<typeof createFakeCustomerAuthLinkGenerator>;
let fakeEmail: ReturnType<typeof createFakeEmailSender>;
const claimMock = vi.fn<(email: string, now: Date, windowSeconds: number, max: number) => Promise<ClaimCustomerLoginLinkRequestResult>>();

vi.mock("../customer-auth-link", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../customer-auth-link")>();
  return { ...actual, createSupabaseCustomerAuthLinkGenerator: () => fakeAuthLink.generator };
});

vi.mock("@/lib/notifications/resend-notification-email-sender", () => ({
  createResendNotificationEmailSender: () => fakeEmail.sender,
}));

vi.mock("../claim-customer-login-link-request", () => ({
  claimCustomerLoginLinkRequest: (email: string, now: Date, windowSeconds: number, max: number) => claimMock(email, now, windowSeconds, max),
}));

const { requestCustomerLoginLinkAction } = await import("./request-customer-login-link-action");

describe("requestCustomerLoginLinkAction", () => {
  it("wires the real constructors together and sends a working sign-in link", async () => {
    fakeAuthLink = createFakeCustomerAuthLinkGenerator();
    fakeEmail = createFakeEmailSender();
    claimMock.mockClear();
    claimMock.mockResolvedValue({ ok: true });

    const result = await requestCustomerLoginLinkAction("customer@example.com", "/my/cleanings");

    expect(result).toEqual({ ok: true });
    expect(claimMock).toHaveBeenCalledWith("customer@example.com", expect.any(Date), 600, 5);
    expect(fakeAuthLink.state.calls).toEqual([{ email: "customer@example.com", path: "/my/cleanings" }]);
    expect(fakeEmail.state.sentEmails).toHaveLength(1);
  });

  it("propagates a rate-limited claim without ever generating a link", async () => {
    fakeAuthLink = createFakeCustomerAuthLinkGenerator();
    fakeEmail = createFakeEmailSender();
    claimMock.mockClear();
    claimMock.mockResolvedValue({ ok: false, reason: "rate_limited" });

    const result = await requestCustomerLoginLinkAction("customer@example.com", "/my");

    expect(result).toEqual({ ok: false, reason: "rate_limited" });
    expect(fakeAuthLink.state.calls).toHaveLength(0);
  });
});
