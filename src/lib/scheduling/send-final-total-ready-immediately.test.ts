import { describe, expect, it } from "vitest";
import { createFakeCustomerAuthLinkGenerator } from "@/lib/customer-portal/test-support/fake-customer-auth-link-generator";
import { createFakeEmailSender } from "@/lib/notifications/test-support/fake-email-sender";
import type { NotificationRecipientContact } from "@/lib/notifications/customer-contact-lookup";
import { createFakeSchedulingRepository } from "./test-support/fake-scheduling-repository";
import { sendFinalTotalReadyImmediately } from "./send-final-total-ready-immediately";

const CONTACT: NotificationRecipientContact = { name: "Jordan", email: "jordan@example.com", phone: null };
const NO_WAIT = async () => {};
const PARAMS = {
  serviceVisitId: "visit-1",
  customerId: "customer-1",
  visitStartAtUtc: new Date("2026-10-20T15:00:00Z"),
  timezone: "America/Chicago",
  totalAmount: 199,
  revisionNumber: 0,
};

function buildDeps(
  fakeScheduling: ReturnType<typeof createFakeSchedulingRepository>,
  overrides?: Partial<{ contact: NotificationRecipientContact | null; authLinkBehavior: Parameters<typeof createFakeCustomerAuthLinkGenerator>[0] }>
) {
  const email = createFakeEmailSender();
  const authLink = createFakeCustomerAuthLinkGenerator(overrides?.authLinkBehavior);
  return {
    repo: fakeScheduling.repo,
    contactLookup: async (): Promise<NotificationRecipientContact | null> =>
      overrides && "contact" in overrides ? overrides.contact ?? null : CONTACT,
    authLinkGenerator: authLink.generator,
    emailSender: email.sender,
    sleep: NO_WAIT,
    emailState: email.state,
    authLinkState: authLink.state,
  };
}

describe("sendFinalTotalReadyImmediately", () => {
  it("sends the final_total_ready email immediately with the authenticated one-click link", async () => {
    const fakeScheduling = createFakeSchedulingRepository();
    const deps = buildDeps(fakeScheduling);

    const result = await sendFinalTotalReadyImmediately(deps, PARAMS);

    expect(result).toEqual({ ok: true, alreadySent: false });
    expect(deps.emailState.sentEmails).toHaveLength(1);
    expect(deps.emailState.sentEmails[0].to).toBe("jordan@example.com");
    expect(deps.authLinkState.calls).toEqual([{ email: "jordan@example.com", path: `/my/payments?visit=${PARAMS.serviceVisitId}` }]);
    const notices = await fakeScheduling.repo.listServiceVisitNotifications(PARAMS.serviceVisitId);
    expect(notices).toHaveLength(1);
    expect(notices[0].state).toBe("sent");
  });

  it("is idempotent at the same amount: a repeat call is a safe no-op, never a second email", async () => {
    const fakeScheduling = createFakeSchedulingRepository();
    const deps = buildDeps(fakeScheduling);

    const first = await sendFinalTotalReadyImmediately(deps, PARAMS);
    const second = await sendFinalTotalReadyImmediately(deps, PARAMS);

    expect(first).toEqual({ ok: true, alreadySent: false });
    expect(second).toEqual({ ok: true, alreadySent: true });
    expect(deps.emailState.sentEmails).toHaveLength(1);
  });

  it("a genuinely different amount (a later scope edit) mints a new notification rather than being swallowed", async () => {
    const fakeScheduling = createFakeSchedulingRepository();
    const deps = buildDeps(fakeScheduling);

    await sendFinalTotalReadyImmediately(deps, PARAMS);
    const second = await sendFinalTotalReadyImmediately(deps, { ...PARAMS, totalAmount: 229 });

    expect(second).toEqual({ ok: true, alreadySent: false });
    expect(deps.emailState.sentEmails).toHaveLength(2);
    const notices = await fakeScheduling.repo.listServiceVisitNotifications(PARAMS.serviceVisitId);
    expect(notices).toHaveLength(2);
  });

  it("retries a transient generateLink failure and still sends a real one-click link once it succeeds — never a plain login-required link", async () => {
    const fakeScheduling = createFakeSchedulingRepository();
    const deps = buildDeps(fakeScheduling, {
      authLinkBehavior: { behavior: (_e, _p, n) => (n < 2 ? { ok: false, reason: "transient" } : undefined) },
    });

    const result = await sendFinalTotalReadyImmediately(deps, PARAMS);

    expect(result).toEqual({ ok: true, alreadySent: false });
    expect(deps.authLinkState.calls).toHaveLength(2);
    expect(deps.emailState.sentEmails).toHaveLength(1);
    const notices = await fakeScheduling.repo.listServiceVisitNotifications(PARAMS.serviceVisitId);
    expect(notices[0].state).toBe("sent");
  });

  it("never sends a plain (login-required) link on generateLink failure: exhausts retries and marks the row terminally failed, recoverable via the existing admin-retry path, instead of degrading the link", async () => {
    const fakeScheduling = createFakeSchedulingRepository();
    const deps = buildDeps(fakeScheduling, { authLinkBehavior: { behavior: () => ({ ok: false, reason: "provider_error" }) } });

    const result = await sendFinalTotalReadyImmediately(deps, PARAMS);

    expect(result).toEqual({ ok: false, reason: "link_generation_failed" });
    expect(deps.authLinkState.calls).toHaveLength(3);
    expect(deps.emailState.sentEmails).toHaveLength(0);
    const notices = await fakeScheduling.repo.listServiceVisitNotifications(PARAMS.serviceVisitId);
    expect(notices[0].state).toBe("failed");
    expect(notices[0].failureReason).toMatch(/link generation failed/i);
  });

  it("reports no_email_on_file and marks the row terminally failed when the customer has no email", async () => {
    const fakeScheduling = createFakeSchedulingRepository();
    const deps = buildDeps(fakeScheduling, { contact: null });

    const result = await sendFinalTotalReadyImmediately(deps, PARAMS);

    expect(result).toEqual({ ok: false, reason: "no_email_on_file" });
    expect(deps.emailState.sentEmails).toHaveLength(0);
    const notices = await fakeScheduling.repo.listServiceVisitNotifications(PARAMS.serviceVisitId);
    expect(notices[0].state).toBe("failed");
  });

  it("treats a lost claim race (row already claimed by something else) as already-handled, not a failure", async () => {
    const fakeScheduling = createFakeSchedulingRepository();
    const deps = buildDeps(fakeScheduling);

    // Simulate another concurrent caller winning the claim first — insert
    // directly as 'sending' so this call's own claimSpecificServiceVisitNotification
    // (a plain WHERE state='pending' update) necessarily finds nothing to claim.
    const idempotencyKey = `${PARAMS.customerId}:${PARAMS.serviceVisitId}:final_total_ready:email:${PARAMS.totalAmount.toFixed(2)}`;
    await fakeScheduling.repo.insertServiceVisitNotification({
      serviceVisitId: PARAMS.serviceVisitId,
      customerId: PARAMS.customerId,
      notificationType: "final_total_ready",
      channel: "email",
      scheduledSendAt: new Date(),
      idempotencyKey,
    });
    const row = (await fakeScheduling.repo.listServiceVisitNotifications(PARAMS.serviceVisitId))[0];
    await fakeScheduling.repo.claimSpecificServiceVisitNotification(row.id);

    const result = await sendFinalTotalReadyImmediately(deps, PARAMS);

    expect(result).toEqual({ ok: true, alreadySent: true });
    expect(deps.emailState.sentEmails).toHaveLength(0);
  });

  it("retries a transient send failure and still resolves to sent, reusing the shared retry helper", async () => {
    const fakeScheduling = createFakeSchedulingRepository();
    const email = createFakeEmailSender({ behavior: (_i, n) => (n < 2 ? { sent: false, failureReason: "transient" } : undefined) });
    const authLink = createFakeCustomerAuthLinkGenerator();
    const deps = {
      repo: fakeScheduling.repo,
      contactLookup: async () => CONTACT,
      authLinkGenerator: authLink.generator,
      emailSender: email.sender,
      sleep: NO_WAIT,
    };

    const result = await sendFinalTotalReadyImmediately(deps, PARAMS);

    expect(result).toEqual({ ok: true, alreadySent: false });
    expect(email.state.sentEmails).toHaveLength(2);
    const notices = await fakeScheduling.repo.listServiceVisitNotifications(PARAMS.serviceVisitId);
    expect(notices[0].state).toBe("sent");
  });

  it("exhausts retries and marks the row terminally failed rather than leaving it eligible for the cron immediately", async () => {
    const fakeScheduling = createFakeSchedulingRepository();
    const email = createFakeEmailSender({ behavior: () => ({ sent: false, failureReason: "outage" }) });
    const authLink = createFakeCustomerAuthLinkGenerator();
    const deps = {
      repo: fakeScheduling.repo,
      contactLookup: async () => CONTACT,
      authLinkGenerator: authLink.generator,
      emailSender: email.sender,
      sleep: NO_WAIT,
    };

    const result = await sendFinalTotalReadyImmediately(deps, PARAMS);

    expect(result).toEqual({ ok: false, reason: "send_failed" });
    expect(email.state.sentEmails).toHaveLength(3);
    const notices = await fakeScheduling.repo.listServiceVisitNotifications(PARAMS.serviceVisitId);
    expect(notices[0].state).toBe("failed");
  });
});
