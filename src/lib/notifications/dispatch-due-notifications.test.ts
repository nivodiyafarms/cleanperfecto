import { describe, expect, it } from "vitest";
import { createFakeSchedulingRepository } from "@/lib/scheduling/test-support/fake-scheduling-repository";
import { createFakeCustomerAuthLinkGenerator } from "@/lib/customer-portal/test-support/fake-customer-auth-link-generator";
import { dispatchDueNotifications } from "./dispatch-due-notifications";
import { enqueueNotification } from "./enqueue-notification";
import { createFakeCustomerNotificationPreferencesRepository } from "./test-support/fake-customer-notification-preferences-repository";
import { createFakeEmailSender } from "./test-support/fake-email-sender";
import { createFakeSmsSender } from "./test-support/fake-sms-sender";

const CONTACT = { name: "Jane Doe", email: "jane@example.com", phone: "+14695551234" };
const contactLookup = async () => CONTACT;

async function seedVisit(repo: ReturnType<typeof createFakeSchedulingRepository>["repo"]) {
  return repo.insertServiceVisit({
    customerId: "customer-1",
    quoteRequestId: null,
    bookingOrderId: "booking-1",
    prepaidPackageId: null,
    recurringScheduleId: null,
    visitNumber: null,
    cleaningType: "standard",
    frequency: "one_time",
    requestedStartAt: null,
    timezone: "America/Chicago",
    serviceAddressLine1: null,
    serviceAddressLine2: null,
    serviceCity: null,
    serviceState: null,
    serviceAddressIdentity: null,
  });
}

describe("dispatchDueNotifications", () => {
  it("sends a due-pending email notification and marks it sent", async () => {
    const { repo } = createFakeSchedulingRepository();
    const visit = await seedVisit(repo);
    await enqueueNotification(repo, {
      serviceVisitId: visit.id,
      customerId: "customer-1",
      notificationType: "appointment_confirmed",
      channel: "email",
      scheduledSendAt: new Date("2026-08-24T00:00:00Z"),
      versionKey: "v1",
    });
    const { repo: preferencesRepo } = createFakeCustomerNotificationPreferencesRepository();
    const { sender: email, state: emailState } = createFakeEmailSender();
    const { sender: sms } = createFakeSmsSender();

    const result = await dispatchDueNotifications(repo, preferencesRepo, { email, sms }, contactLookup, new Date("2026-08-24T01:00:00Z"));

    expect(result).toEqual({ claimed: 1, sent: 1, retried: 0, failedTerminal: 0 });
    expect(emailState.sentEmails.length).toBe(1);
    expect(emailState.sentEmails[0].to).toBe(CONTACT.email);
  });

  // NOTE: claim due-ness is evaluated by claimDueServiceVisitNotifications
  // itself (the fake mirrors the real Postgres RPC's use of `now()`) against
  // the REAL wall clock — never against the `now` parameter passed to
  // dispatchDueNotifications, which only ever affects retry-backoff
  // scheduling math (see recordOutcome above). So every fixture below uses
  // an offset relative to Date.now(), never a fixed calendar date — a fixed
  // future date eventually becomes the past as real time advances, which is
  // exactly what caused this test to start failing.

  it("does not claim a pending row whose scheduled_send_at is still in the future", async () => {
    const { repo } = createFakeSchedulingRepository();
    const visit = await seedVisit(repo);
    await enqueueNotification(repo, {
      serviceVisitId: visit.id,
      customerId: "customer-1",
      notificationType: "reminder_24h",
      channel: "email",
      scheduledSendAt: new Date(Date.now() + 24 * 60 * 60_000),
      versionKey: "v1",
    });
    const { repo: preferencesRepo } = createFakeCustomerNotificationPreferencesRepository();
    const { sender: email } = createFakeEmailSender();
    const { sender: sms } = createFakeSmsSender();

    const result = await dispatchDueNotifications(repo, preferencesRepo, { email, sms }, contactLookup);
    expect(result.claimed).toBe(0);
  });

  it("claims a pending row whose scheduled_send_at is exactly now", async () => {
    const { repo } = createFakeSchedulingRepository();
    const visit = await seedVisit(repo);
    const exactlyNow = new Date();
    await enqueueNotification(repo, {
      serviceVisitId: visit.id,
      customerId: "customer-1",
      notificationType: "reminder_24h",
      channel: "email",
      scheduledSendAt: exactlyNow,
      versionKey: "v1",
    });
    const { repo: preferencesRepo } = createFakeCustomerNotificationPreferencesRepository();
    const { sender: email } = createFakeEmailSender();
    const { sender: sms } = createFakeSmsSender();

    const result = await dispatchDueNotifications(repo, preferencesRepo, { email, sms }, contactLookup);
    expect(result.claimed).toBe(1);
  });

  // A true 1ms boundary can't be asserted reliably against the real wall
  // clock without mocking it (no fake-timer convention exists elsewhere in
  // this suite) — real execution time between enqueueing and dispatching
  // would make a 1ms-wide window flaky in either direction. This uses a
  // margin generous enough to never be crossed by normal test execution,
  // while still being far short of any real dispatch cadence (the cron runs
  // every 5 minutes), so it still meaningfully exercises the boundary.
  const SAFE_TEST_MARGIN_MS = 60_000;

  it("claims a pending row scheduled shortly in the past, and never claims one scheduled shortly in the future", async () => {
    const { repo: pastRepo } = createFakeSchedulingRepository();
    const pastVisit = await seedVisit(pastRepo);
    await enqueueNotification(pastRepo, {
      serviceVisitId: pastVisit.id,
      customerId: "customer-1",
      notificationType: "reminder_24h",
      channel: "email",
      scheduledSendAt: new Date(Date.now() - SAFE_TEST_MARGIN_MS),
      versionKey: "v1",
    });
    const { repo: pastPreferencesRepo } = createFakeCustomerNotificationPreferencesRepository();
    const pastResult = await dispatchDueNotifications(
      pastRepo,
      pastPreferencesRepo,
      { email: createFakeEmailSender().sender, sms: createFakeSmsSender().sender },
      contactLookup
    );
    expect(pastResult.claimed).toBe(1);

    const { repo: futureRepo } = createFakeSchedulingRepository();
    const futureVisit = await seedVisit(futureRepo);
    await enqueueNotification(futureRepo, {
      serviceVisitId: futureVisit.id,
      customerId: "customer-1",
      notificationType: "reminder_24h",
      channel: "email",
      scheduledSendAt: new Date(Date.now() + SAFE_TEST_MARGIN_MS),
      versionKey: "v1",
    });
    const { repo: futurePreferencesRepo } = createFakeCustomerNotificationPreferencesRepository();
    const futureResult = await dispatchDueNotifications(
      futureRepo,
      futurePreferencesRepo,
      { email: createFakeEmailSender().sender, sms: createFakeSmsSender().sender },
      contactLookup
    );
    expect(futureResult.claimed).toBe(0);
  });

  it("gates claiming on the absolute instant, never on the ISO string's timezone offset", async () => {
    const { repo } = createFakeSchedulingRepository();
    const visit = await seedVisit(repo);
    // Same absolute instant as `Date.now() + 2 hours`, merely expressed with
    // a non-UTC offset — must still be treated as 2 hours in the future, not
    // "already due" due to any naive string/local-time comparison.
    const twoHoursFromNow = new Date(Date.now() + 2 * 60 * 60_000);
    const nonUtcIso = new Date(twoHoursFromNow.getTime() + 5 * 60 * 60_000).toISOString().replace("Z", "+05:00");
    expect(new Date(nonUtcIso).getTime()).toBe(twoHoursFromNow.getTime());

    await enqueueNotification(repo, {
      serviceVisitId: visit.id,
      customerId: "customer-1",
      notificationType: "reminder_24h",
      channel: "email",
      scheduledSendAt: new Date(nonUtcIso),
      versionKey: "v1",
    });
    const { repo: preferencesRepo } = createFakeCustomerNotificationPreferencesRepository();
    const { sender: email } = createFakeEmailSender();
    const { sender: sms } = createFakeSmsSender();

    const result = await dispatchDueNotifications(repo, preferencesRepo, { email, sms }, contactLookup);
    expect(result.claimed).toBe(0);
  });

  it("a failed send under the retry cap increments retry_count and returns to pending with a later scheduled_send_at", async () => {
    const { repo, state } = createFakeSchedulingRepository();
    const visit = await seedVisit(repo);
    await enqueueNotification(repo, {
      serviceVisitId: visit.id,
      customerId: "customer-1",
      notificationType: "cancelled",
      channel: "email",
      scheduledSendAt: new Date("2026-08-24T00:00:00Z"),
      versionKey: "v1",
    });
    const { repo: preferencesRepo } = createFakeCustomerNotificationPreferencesRepository();
    const { sender: email } = createFakeEmailSender({ behavior: () => ({ sent: false, failureReason: "provider timeout" }) });
    const { sender: sms } = createFakeSmsSender();

    const now = new Date("2026-08-24T01:00:00Z");
    const result = await dispatchDueNotifications(repo, preferencesRepo, { email, sms }, contactLookup, now);

    expect(result).toEqual({ claimed: 1, sent: 0, retried: 1, failedTerminal: 0 });
    const notification = [...state.notifications.values()][0];
    expect(notification.state).toBe("pending");
    expect(notification.retryCount).toBe(1);
    expect(notification.failureReason).toBe("provider timeout");
    expect(notification.scheduledSendAt.getTime()).toBeGreaterThan(now.getTime());
  });

  it("reaching the retry cap (5 total attempts) marks the row terminal 'failed', never retried again", async () => {
    const { repo, state } = createFakeSchedulingRepository();
    const visit = await seedVisit(repo);
    await enqueueNotification(repo, {
      serviceVisitId: visit.id,
      customerId: "customer-1",
      notificationType: "cancelled",
      channel: "email",
      scheduledSendAt: new Date("2026-08-24T00:00:00Z"),
      versionKey: "v1",
    });
    const { repo: preferencesRepo } = createFakeCustomerNotificationPreferencesRepository();
    const { sender: email } = createFakeEmailSender({ behavior: () => ({ sent: false, failureReason: "provider down" }) });
    const { sender: sms } = createFakeSmsSender();

    // Each dispatch call claims the row again (its scheduled_send_at was
    // pushed into the future, but we advance `now` past it each time,
    // simulating successive cron ticks).
    let now = new Date("2026-08-24T01:00:00Z");
    for (let attempt = 1; attempt <= 5; attempt++) {
      await dispatchDueNotifications(repo, preferencesRepo, { email, sms }, contactLookup, now);
      now = new Date(now.getTime() + 15 * 60_000);
    }

    const notification = [...state.notifications.values()][0];
    expect(notification.state).toBe("failed");
    expect(notification.retryCount).toBe(5);

    // A 6th tick must not touch it again — it's terminal.
    const result = await dispatchDueNotifications(repo, preferencesRepo, { email, sms }, contactLookup, now);
    expect(result.claimed).toBe(0);
  });

  it("a stale 'sending' row (past the lease window) is reclaimed and processed on the next dispatch", async () => {
    // The real claim RPC evaluates staleness against Postgres's own now()
    // (see claim_due_service_visit_notifications() and its fake mirror,
    // which correspondingly uses the real wall clock, not the `now`
    // parameter passed to dispatchDueNotifications — that parameter only
    // ever affects retry-backoff scheduling math). So this test simulates
    // staleness with REAL relative offsets from Date.now(), not fixed
    // calendar dates.
    const { repo, state } = createFakeSchedulingRepository();
    const visit = await seedVisit(repo);
    await enqueueNotification(repo, {
      serviceVisitId: visit.id,
      customerId: "customer-1",
      notificationType: "cancelled",
      channel: "email",
      scheduledSendAt: new Date(Date.now() - 60 * 60_000),
      versionKey: "v1",
    });
    // Simulate a worker that claimed the row and then died before recording any outcome.
    const notification = [...state.notifications.values()][0];
    notification.state = "sending";
    notification.claimedAt = new Date(Date.now() - 5 * 60_000); // 5 minutes ago

    const { repo: preferencesRepo } = createFakeCustomerNotificationPreferencesRepository();
    const { sender: email, state: emailState } = createFakeEmailSender();
    const { sender: sms } = createFakeSmsSender();

    // Claimed only 5 minutes ago — still within the 10-minute lease, must NOT be reclaimed.
    const tooSoon = await dispatchDueNotifications(repo, preferencesRepo, { email, sms }, contactLookup);
    expect(tooSoon.claimed).toBe(0);
    expect(emailState.sentEmails.length).toBe(0);

    // Push the claim 15 minutes into the past — now past the 10-minute lease, must be reclaimed and sent.
    notification.claimedAt = new Date(Date.now() - 15 * 60_000);
    const reclaimed = await dispatchDueNotifications(repo, preferencesRepo, { email, sms }, contactLookup);
    expect(reclaimed.claimed).toBe(1);
    expect(reclaimed.sent).toBe(1);
    expect(emailState.sentEmails.length).toBe(1);
  });

  it("an sms-channel row is never sent without sms_opt_in — marked failed immediately, no real send attempted", async () => {
    const { repo, state } = createFakeSchedulingRepository();
    const visit = await seedVisit(repo);
    await enqueueNotification(repo, {
      serviceVisitId: visit.id,
      customerId: "customer-1",
      notificationType: "reminder_24h",
      channel: "sms",
      scheduledSendAt: new Date("2026-08-24T00:00:00Z"),
      versionKey: "v1",
    });
    const { repo: preferencesRepo } = createFakeCustomerNotificationPreferencesRepository({ "customer-1": false });
    const { sender: email } = createFakeEmailSender();
    const { sender: sms, state: smsState } = createFakeSmsSender();

    const result = await dispatchDueNotifications(repo, preferencesRepo, { email, sms }, contactLookup, new Date("2026-08-24T01:00:00Z"));

    expect(result.failedTerminal).toBe(1);
    expect(smsState.sentSms.length).toBe(0);
    const notification = [...state.notifications.values()][0];
    expect(notification.state).toBe("failed");
    expect(notification.failureReason).toBe("sms_opt_in not granted");
  });

  it("an sms-channel row IS sent via the fake sender once the customer has opted in", async () => {
    const { repo } = createFakeSchedulingRepository();
    const visit = await seedVisit(repo);
    await enqueueNotification(repo, {
      serviceVisitId: visit.id,
      customerId: "customer-1",
      notificationType: "reminder_24h",
      channel: "sms",
      scheduledSendAt: new Date("2026-08-24T00:00:00Z"),
      versionKey: "v1",
    });
    const { repo: preferencesRepo } = createFakeCustomerNotificationPreferencesRepository({ "customer-1": true });
    const { sender: email } = createFakeEmailSender();
    const { sender: sms, state: smsState } = createFakeSmsSender();

    const result = await dispatchDueNotifications(repo, preferencesRepo, { email, sms }, contactLookup, new Date("2026-08-24T01:00:00Z"));

    expect(result.sent).toBe(1);
    expect(smsState.sentSms.length).toBe(1);
    expect(smsState.sentSms[0].to).toBe(CONTACT.phone);
  });

  describe("final_total_ready one-click authenticated link", () => {
    it("without an authLinkGenerator supplied, sends the plain (login-required) portal link — existing behavior unaffected", async () => {
      const { repo } = createFakeSchedulingRepository();
      const visit = await seedVisit(repo);
      await enqueueNotification(repo, {
        serviceVisitId: visit.id,
        customerId: "customer-1",
        notificationType: "final_total_ready",
        channel: "email",
        scheduledSendAt: new Date("2026-08-24T00:00:00Z"),
        versionKey: "v1",
      });
      const { repo: preferencesRepo } = createFakeCustomerNotificationPreferencesRepository();
      const { sender: email, state: emailState } = createFakeEmailSender();
      const { sender: sms } = createFakeSmsSender();

      const result = await dispatchDueNotifications(repo, preferencesRepo, { email, sms }, contactLookup, new Date("2026-08-24T01:00:00Z"));

      expect(result).toEqual({ claimed: 1, sent: 1, retried: 0, failedTerminal: 0 });
      expect(emailState.sentEmails[0].text).toContain(`/my/payments?visit=${visit.id}`);
    });

    it("with an authLinkGenerator supplied, sends the one-click authenticated link instead, calling the generator with the customer's own contact email and the visit-specific path", async () => {
      const { repo } = createFakeSchedulingRepository();
      const visit = await seedVisit(repo);
      await enqueueNotification(repo, {
        serviceVisitId: visit.id,
        customerId: "customer-1",
        notificationType: "final_total_ready",
        channel: "email",
        scheduledSendAt: new Date("2026-08-24T00:00:00Z"),
        versionKey: "v1",
      });
      const { repo: preferencesRepo } = createFakeCustomerNotificationPreferencesRepository();
      const { sender: email, state: emailState } = createFakeEmailSender();
      const { sender: sms } = createFakeSmsSender();
      const { generator: authLinkGenerator, state: authState } = createFakeCustomerAuthLinkGenerator();

      const result = await dispatchDueNotifications(
        repo,
        preferencesRepo,
        { email, sms },
        contactLookup,
        new Date("2026-08-24T01:00:00Z"),
        authLinkGenerator
      );

      expect(result).toEqual({ claimed: 1, sent: 1, retried: 0, failedTerminal: 0 });
      expect(authState.calls).toEqual([{ email: CONTACT.email, path: `/my/payments?visit=${visit.id}` }]);
      expect(emailState.sentEmails[0].text).not.toContain(`/my/payments?visit=${visit.id}`);
      expect(emailState.sentEmails[0].text).toContain("fake.supabase.co");
    });

    it("gracefully degrades to the plain portal link (never fails/retries the notification) when the authenticated link generator fails", async () => {
      const { repo } = createFakeSchedulingRepository();
      const visit = await seedVisit(repo);
      await enqueueNotification(repo, {
        serviceVisitId: visit.id,
        customerId: "customer-1",
        notificationType: "final_total_ready",
        channel: "email",
        scheduledSendAt: new Date("2026-08-24T00:00:00Z"),
        versionKey: "v1",
      });
      const { repo: preferencesRepo } = createFakeCustomerNotificationPreferencesRepository();
      const { sender: email, state: emailState } = createFakeEmailSender();
      const { sender: sms } = createFakeSmsSender();
      const { generator: authLinkGenerator } = createFakeCustomerAuthLinkGenerator({
        behavior: () => ({ ok: false, reason: "simulated Supabase Admin API failure" }),
      });

      const result = await dispatchDueNotifications(
        repo,
        preferencesRepo,
        { email, sms },
        contactLookup,
        new Date("2026-08-24T01:00:00Z"),
        authLinkGenerator
      );

      expect(result).toEqual({ claimed: 1, sent: 1, retried: 0, failedTerminal: 0 });
      expect(emailState.sentEmails[0].text).toContain(`/my/payments?visit=${visit.id}`);
    });

    it("never calls the authLinkGenerator for a non-final_total_ready notification, even when one is supplied", async () => {
      const { repo } = createFakeSchedulingRepository();
      const visit = await seedVisit(repo);
      await enqueueNotification(repo, {
        serviceVisitId: visit.id,
        customerId: "customer-1",
        notificationType: "appointment_confirmed",
        channel: "email",
        scheduledSendAt: new Date("2026-08-24T00:00:00Z"),
        versionKey: "v1",
      });
      const { repo: preferencesRepo } = createFakeCustomerNotificationPreferencesRepository();
      const { sender: email } = createFakeEmailSender();
      const { sender: sms } = createFakeSmsSender();
      const { generator: authLinkGenerator, state: authState } = createFakeCustomerAuthLinkGenerator();

      await dispatchDueNotifications(repo, preferencesRepo, { email, sms }, contactLookup, new Date("2026-08-24T01:00:00Z"), authLinkGenerator);

      expect(authState.calls).toEqual([]);
    });

    it("never calls the authLinkGenerator for an sms-channel final_total_ready row, even when one is supplied", async () => {
      const { repo } = createFakeSchedulingRepository();
      const visit = await seedVisit(repo);
      await enqueueNotification(repo, {
        serviceVisitId: visit.id,
        customerId: "customer-1",
        notificationType: "final_total_ready",
        channel: "sms",
        scheduledSendAt: new Date("2026-08-24T00:00:00Z"),
        versionKey: "v1",
      });
      const { repo: preferencesRepo } = createFakeCustomerNotificationPreferencesRepository({ "customer-1": true });
      const { sender: email } = createFakeEmailSender();
      const { sender: sms } = createFakeSmsSender();
      const { generator: authLinkGenerator, state: authState } = createFakeCustomerAuthLinkGenerator();

      await dispatchDueNotifications(repo, preferencesRepo, { email, sms }, contactLookup, new Date("2026-08-24T01:00:00Z"), authLinkGenerator);

      expect(authState.calls).toEqual([]);
    });
  });
});
