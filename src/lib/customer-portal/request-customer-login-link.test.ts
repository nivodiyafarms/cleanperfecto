import { describe, expect, it, vi } from "vitest";
import { createFakeCustomerAuthLinkGenerator } from "./test-support/fake-customer-auth-link-generator";
import { createFakeEmailSender } from "@/lib/notifications/test-support/fake-email-sender";
import { requestCustomerLoginLink } from "./request-customer-login-link";

const NO_WAIT = async () => {};

function buildDeps(overrides?: {
  claim?: () => Promise<{ ok: true } | { ok: false; reason: "rate_limited" }>;
  authLinkBehavior?: Parameters<typeof createFakeCustomerAuthLinkGenerator>[0];
  emailBehavior?: Parameters<typeof createFakeEmailSender>[0];
}) {
  const authLink = createFakeCustomerAuthLinkGenerator(overrides?.authLinkBehavior);
  const email = createFakeEmailSender(overrides?.emailBehavior);
  const claimLoginLinkRequest = overrides?.claim ?? (async () => ({ ok: true as const }));
  return {
    claimLoginLinkRequest,
    authLinkGenerator: authLink.generator,
    emailSender: email.sender,
    sleep: NO_WAIT,
    authLinkState: authLink.state,
    emailState: email.state,
  };
}

describe("requestCustomerLoginLink", () => {
  it("sends a real one-click link via the shared generator + email sender", async () => {
    const deps = buildDeps();

    const result = await requestCustomerLoginLink(deps, "Customer@Example.com", "/my/cleanings");

    expect(result).toEqual({ ok: true });
    expect(deps.authLinkState.calls).toEqual([{ email: "customer@example.com", path: "/my/cleanings" }]);
    expect(deps.emailState.sentEmails).toHaveLength(1);
    expect(deps.emailState.sentEmails[0].to).toBe("customer@example.com");
  });

  it("embeds the destination in the generated link itself, not a cookie — the fix for 'opens in another browser'", async () => {
    const deps = buildDeps();

    await requestCustomerLoginLink(deps, "customer@example.com", "/my/invoices");

    expect(deps.authLinkState.calls[0].path).toBe("/my/invoices");
  });

  it("is blocked by the rate limiter without ever attempting to generate a link or send an email", async () => {
    const deps = buildDeps({ claim: async () => ({ ok: false, reason: "rate_limited" }) });

    const result = await requestCustomerLoginLink(deps, "customer@example.com", "/my");

    expect(result).toEqual({ ok: false, reason: "rate_limited" });
    expect(deps.authLinkState.calls).toHaveLength(0);
    expect(deps.emailState.sentEmails).toHaveLength(0);
  });

  it("never reveals whether the email matches a real customer: an unmatched email gets the exact same ok:true outcome as a matched one, since generateLink is always attempted", async () => {
    const deps = buildDeps();

    const result = await requestCustomerLoginLink(deps, "nobody-like-this-exists@example.com", "/my");

    expect(result).toEqual({ ok: true });
    expect(deps.emailState.sentEmails).toHaveLength(1);
  });

  it("reports a generic 'error' (never the real reason) when link generation fails", async () => {
    const deps = buildDeps({ authLinkBehavior: { behavior: () => ({ ok: false, reason: "some internal Supabase detail" }) } });

    const result = await requestCustomerLoginLink(deps, "customer@example.com", "/my");

    expect(result).toEqual({ ok: false, reason: "error" });
    expect(deps.emailState.sentEmails).toHaveLength(0);
  });

  it("retries a transient send failure and still resolves ok", async () => {
    const deps = buildDeps({ emailBehavior: { behavior: (_i, n) => (n < 2 ? { sent: false, failureReason: "transient" } : undefined) } });

    const result = await requestCustomerLoginLink(deps, "customer@example.com", "/my");

    expect(result).toEqual({ ok: true });
    expect(deps.emailState.sentEmails).toHaveLength(2);
  });

  it("exhausts retries and reports a generic error after 3 attempts", async () => {
    const deps = buildDeps({ emailBehavior: { behavior: () => ({ sent: false, failureReason: "outage" }) } });

    const result = await requestCustomerLoginLink(deps, "customer@example.com", "/my");

    expect(result).toEqual({ ok: false, reason: "error" });
    expect(deps.emailState.sentEmails).toHaveLength(3);
  });

  it("reuses the exact same idempotencyKey and payload across every retry attempt", async () => {
    const seenKeys: string[] = [];
    const deps = buildDeps({
      emailBehavior: {
        behavior: (input, n) => {
          seenKeys.push(input.idempotencyKey);
          return n < 2 ? { sent: false, failureReason: "transient" } : undefined;
        },
      },
    });

    await requestCustomerLoginLink(deps, "customer@example.com", "/my");

    expect(new Set(seenKeys).size).toBe(1);
  });

  it("rejects an empty or malformed email before ever claiming a rate-limit slot", async () => {
    const claim = vi.fn(async () => ({ ok: true as const }));
    const deps = buildDeps({ claim });

    const empty = await requestCustomerLoginLink(deps, "", "/my");
    const malformed = await requestCustomerLoginLink(deps, "not-an-email", "/my");

    expect(empty).toEqual({ ok: false, reason: "error" });
    expect(malformed).toEqual({ ok: false, reason: "error" });
    expect(claim).not.toHaveBeenCalled();
  });

  it("normalizes email case/whitespace before rate-limiting, link generation, and sending", async () => {
    const seenEmails: string[] = [];
    const deps = buildDeps();
    const claimSpy = vi.fn(async (email: string) => {
      seenEmails.push(email);
      return { ok: true as const };
    });

    await requestCustomerLoginLink({ ...deps, claimLoginLinkRequest: claimSpy }, "  Customer@Example.com  ", "/my");

    expect(seenEmails).toEqual(["customer@example.com"]);
    expect(deps.authLinkState.calls[0].email).toBe("customer@example.com");
  });
});
