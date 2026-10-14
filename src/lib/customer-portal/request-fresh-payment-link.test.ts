import { describe, expect, it } from "vitest";
import { createFakeSchedulingRepository } from "@/lib/scheduling/test-support/fake-scheduling-repository";
import { createFakeEmailSender } from "@/lib/notifications/test-support/fake-email-sender";
import { createFakeCustomerAuthLinkGenerator } from "./test-support/fake-customer-auth-link-generator";
import type { NewServiceVisitRow } from "@/lib/scheduling/domain-types";
import type { NotificationRecipientContact } from "@/lib/notifications/customer-contact-lookup";
import { requestFreshPaymentLink } from "./request-fresh-payment-link";

const NEW_VISIT: NewServiceVisitRow = {
  customerId: "customer-1",
  quoteRequestId: null,
  bookingOrderId: null,
  prepaidPackageId: null,
  recurringScheduleId: null,
  visitNumber: null,
  cleaningType: "standard",
  frequency: "one_time",
  requestedStartAt: new Date(),
  timezone: "America/Chicago",
  serviceAddressLine1: "123 Main St",
  serviceAddressLine2: null,
  serviceCity: "Frisco",
  serviceState: "TX",
  serviceAddressIdentity: "75056|123 MAIN ST|",
};

async function seedCompletedConfirmedVisit(fakeScheduling: ReturnType<typeof createFakeSchedulingRepository>, customerId = "customer-1") {
  const visit = await fakeScheduling.repo.insertServiceVisit({ ...NEW_VISIT, customerId });
  await fakeScheduling.repo.upsertServiceVisitPricing({
    serviceVisitId: visit.id,
    pricingVersion: "v1",
    pricingSnapshot: {},
    baseAmount: 179,
    addOnIds: [],
    addOnAmount: 0,
    totalAmount: 179,
    amountDueFromCustomer: 179,
    priceStatus: "estimated",
    requiresCustomerApproval: false,
    previouslyApprovedAmount: null,
  });
  await fakeScheduling.repo.confirmServiceVisitPricing(visit.id, "admin:1");
  fakeScheduling.state.serviceVisitsById.set(visit.id, {
    ...(await fakeScheduling.repo.findServiceVisitById(visit.id))!,
    status: "completed",
  });
  return visit.id;
}

const CONTACT: NotificationRecipientContact = { name: "Jordan", email: "jordan@example.com", phone: null };

const NO_WAIT = async () => {};
/** Mirrors RATE_LIMIT_MAX_ATTEMPTS inside request-fresh-payment-link.ts — not imported directly since that constant isn't exported (it's an internal implementation detail), only its observable effect is. */
const RATE_LIMIT_MAX_ATTEMPTS_FOR_TEST = 3;

function buildDeps(
  fakeScheduling: ReturnType<typeof createFakeSchedulingRepository>,
  overrides?: Partial<{ contact: NotificationRecipientContact | null; now: () => Date }>
) {
  const email = createFakeEmailSender();
  const authLink = createFakeCustomerAuthLinkGenerator();
  return {
    repo: fakeScheduling.repo,
    contactLookup: async () => overrides?.contact ?? CONTACT,
    authLinkGenerator: authLink.generator,
    emailSender: email.sender,
    now: overrides?.now,
    sleep: NO_WAIT,
    emailState: email.state,
    authLinkState: authLink.state,
  };
}

describe("requestFreshPaymentLink", () => {
  it("sends a fresh one-click link for a completed, confirmed, unpaid visit", async () => {
    const fakeScheduling = createFakeSchedulingRepository();
    const visitId = await seedCompletedConfirmedVisit(fakeScheduling);
    const deps = buildDeps(fakeScheduling);

    const result = await requestFreshPaymentLink(deps, visitId);

    expect(result).toEqual({ ok: true });
    expect(deps.authLinkState.calls).toEqual([{ email: "jordan@example.com", path: `/my/payments?visit=${visitId}` }]);
    expect(deps.emailState.sentEmails).toHaveLength(1);
    expect(deps.emailState.sentEmails[0].to).toBe("jordan@example.com");
  });

  it("is not deduped by (visit, amount) the way the old enqueue-the-cron path was — a genuinely later, well-spaced resend still sends", async () => {
    const fakeScheduling = createFakeSchedulingRepository();
    const visitId = await seedCompletedConfirmedVisit(fakeScheduling);
    let clock = Date.parse("2026-10-14T00:00:00Z");
    const deps = buildDeps(fakeScheduling, { now: () => new Date(clock) });

    await requestFreshPaymentLink(deps, visitId);
    clock += 60_000; // past the 30s duplicate-cooldown, nowhere near the 1h rate limit
    const second = await requestFreshPaymentLink(deps, visitId);

    expect(second).toEqual({ ok: true });
    expect(deps.emailState.sentEmails).toHaveLength(2);
  });

  it("duplicate protection: a second request within the cooldown window is rejected, and never sends a second email", async () => {
    const fakeScheduling = createFakeSchedulingRepository();
    const visitId = await seedCompletedConfirmedVisit(fakeScheduling);
    const fixedNow = () => new Date("2026-10-14T00:00:00Z");
    const deps = buildDeps(fakeScheduling, { now: fixedNow });

    const first = await requestFreshPaymentLink(deps, visitId);
    const second = await requestFreshPaymentLink(deps, visitId);

    expect(first).toEqual({ ok: true });
    expect(second).toEqual({ ok: false, reason: "duplicate_request" });
    expect(deps.emailState.sentEmails).toHaveLength(1);
  });

  it("rate limiting: more than 3 resend attempts within an hour are blocked, even when each is individually past the duplicate-cooldown", async () => {
    const fakeScheduling = createFakeSchedulingRepository();
    const visitId = await seedCompletedConfirmedVisit(fakeScheduling);
    let clock = Date.parse("2026-10-14T00:00:00Z");
    const deps = buildDeps(fakeScheduling, { now: () => new Date(clock) });

    const results: boolean[] = [];
    for (let i = 0; i < 4; i++) {
      const result = await requestFreshPaymentLink(deps, visitId);
      results.push(result.ok);
      clock += 60_000;
    }

    expect(results).toEqual([true, true, true, false]);
    expect(deps.emailState.sentEmails).toHaveLength(3);
  });

  it("rate limiting does not count the original automated Finalize & Send toward the limit — only this function's own prior attempts", async () => {
    const fakeScheduling = createFakeSchedulingRepository();
    const visitId = await seedCompletedConfirmedVisit(fakeScheduling);
    // Simulate the original automated send's ledger row — a DIFFERENT
    // idempotency key shape (no ":resend:" marker), exactly what
    // finalize-and-send.ts's enqueueNotification produces.
    await fakeScheduling.repo.insertServiceVisitNotification({
      serviceVisitId: visitId,
      customerId: "customer-1",
      notificationType: "final_total_ready",
      channel: "email",
      scheduledSendAt: new Date("2026-10-14T00:00:00Z"),
      idempotencyKey: "customer-1:" + visitId + ":final_total_ready:email:179.00",
    });
    const deps = buildDeps(fakeScheduling, { now: () => new Date("2026-10-14T00:05:00Z") });

    const result = await requestFreshPaymentLink(deps, visitId);

    expect(result).toEqual({ ok: true });
  });

  it("retry handling: a transient failure followed by success still reports ok — the ledger row ends up marked sent, not failed", async () => {
    const fakeScheduling = createFakeSchedulingRepository();
    const visitId = await seedCompletedConfirmedVisit(fakeScheduling);
    const flakyEmail = createFakeEmailSender({
      behavior: (_input, callNumber) => (callNumber < 2 ? { sent: false, failureReason: "transient" } : undefined),
    });
    const deps = buildDeps(fakeScheduling);

    const result = await requestFreshPaymentLink({ ...deps, emailSender: flakyEmail.sender }, visitId);

    expect(result).toEqual({ ok: true });
    expect(flakyEmail.state.sentEmails).toHaveLength(2);
    const notifications = await fakeScheduling.repo.listServiceVisitNotifications(visitId);
    const resendRow = notifications.find((n) => n.idempotencyKey.includes(":resend:"));
    expect(resendRow?.state).toBe("sent");
  });

  it("returns visit_not_found for a nonexistent visit, without ever calling the contact lookup or sending anything", async () => {
    const fakeScheduling = createFakeSchedulingRepository();
    const deps = buildDeps(fakeScheduling);

    const result = await requestFreshPaymentLink(deps, "00000000-0000-0000-0000-000000000000");

    expect(result).toEqual({ ok: false, reason: "visit_not_found" });
    expect(deps.emailState.sentEmails).toHaveLength(0);
  });

  it("returns not_payable for a visit that hasn't completed yet", async () => {
    const fakeScheduling = createFakeSchedulingRepository();
    const visit = await fakeScheduling.repo.insertServiceVisit(NEW_VISIT);
    const deps = buildDeps(fakeScheduling);

    const result = await requestFreshPaymentLink(deps, visit.id);

    expect(result).toEqual({ ok: false, reason: "not_payable" });
    expect(deps.emailState.sentEmails).toHaveLength(0);
  });

  it("returns not_payable for a visit with no confirmed pricing row", async () => {
    const fakeScheduling = createFakeSchedulingRepository();
    const visit = await fakeScheduling.repo.insertServiceVisit(NEW_VISIT);
    fakeScheduling.state.serviceVisitsById.set(visit.id, { ...(await fakeScheduling.repo.findServiceVisitById(visit.id))!, status: "completed" });
    const deps = buildDeps(fakeScheduling);

    const result = await requestFreshPaymentLink(deps, visit.id);

    expect(result).toEqual({ ok: false, reason: "not_payable" });
  });

  it("returns not_payable for a visit that has already been paid — no reason to resend a payment link for a settled visit", async () => {
    const fakeScheduling = createFakeSchedulingRepository();
    const visitId = await seedCompletedConfirmedVisit(fakeScheduling);
    const pricing = await fakeScheduling.repo.findServiceVisitPricingByVisitId(visitId);
    // upsertServiceVisitPricing never touches paymentStatus by design (it's
    // not part of NewServiceVisitPricingRow) — set it directly on the
    // fake's own state map, same approach used for visit.status above.
    fakeScheduling.state.servicePricingByVisitId.set(visitId, { ...pricing!, paymentStatus: "paid" });
    const deps = buildDeps(fakeScheduling);

    const result = await requestFreshPaymentLink(deps, visitId);

    expect(result).toEqual({ ok: false, reason: "not_payable" });
    expect(deps.emailState.sentEmails).toHaveLength(0);
  });

  it("returns no_email_on_file when the customer has no email, without attempting link generation", async () => {
    const fakeScheduling = createFakeSchedulingRepository();
    const visitId = await seedCompletedConfirmedVisit(fakeScheduling);
    const deps = buildDeps(fakeScheduling, { contact: { name: "Jordan", email: null, phone: null } });

    const result = await requestFreshPaymentLink(deps, visitId);

    expect(result).toEqual({ ok: false, reason: "no_email_on_file" });
    expect(deps.authLinkState.calls).toHaveLength(0);
  });

  it("returns link_generation_failed and NEVER falls back to a plain login-required link — unlike the automated dispatcher, a plain link here would just return the customer to this same expired-link page", async () => {
    const fakeScheduling = createFakeSchedulingRepository();
    const visitId = await seedCompletedConfirmedVisit(fakeScheduling);
    const fakeAuthLink = createFakeCustomerAuthLinkGenerator({ behavior: () => ({ ok: false, reason: "simulated failure" }) });
    const fakeEmail = createFakeEmailSender();

    const result = await requestFreshPaymentLink(
      { repo: fakeScheduling.repo, contactLookup: async () => CONTACT, authLinkGenerator: fakeAuthLink.generator, emailSender: fakeEmail.sender },
      visitId
    );

    expect(result).toEqual({ ok: false, reason: "link_generation_failed" });
    expect(fakeEmail.state.sentEmails).toHaveLength(0);
  });

  it("returns send_failed after exhausting retries, and marks the ledger row failed with the real reason — never left 'pending' for a cron that will never come", async () => {
    const fakeScheduling = createFakeSchedulingRepository();
    const visitId = await seedCompletedConfirmedVisit(fakeScheduling);
    const deps = buildDeps(fakeScheduling);
    const failingEmail = createFakeEmailSender({ behavior: () => ({ sent: false, failureReason: "simulated provider failure" }) });

    const result = await requestFreshPaymentLink({ ...deps, emailSender: failingEmail.sender }, visitId);

    expect(result).toEqual({ ok: false, reason: "send_failed" });
    // One initial attempt plus two retries — never retried forever.
    expect(failingEmail.state.sentEmails).toHaveLength(3);
    const notifications = await fakeScheduling.repo.listServiceVisitNotifications(visitId);
    const resendRow = notifications.find((n) => n.idempotencyKey.includes(":resend:"));
    expect(resendRow?.state).toBe("failed");
    expect(resendRow?.failureReason).toBe("simulated provider failure");
  });

  it("no_email_on_file still resolves the claimed ledger row to 'failed' — never leaves it stranded 'sending' after the claim succeeded", async () => {
    const fakeScheduling = createFakeSchedulingRepository();
    const visitId = await seedCompletedConfirmedVisit(fakeScheduling);
    const deps = buildDeps(fakeScheduling, { contact: { name: "Jordan", email: null, phone: null } });

    await requestFreshPaymentLink(deps, visitId);

    const notifications = await fakeScheduling.repo.listServiceVisitNotifications(visitId);
    const resendRow = notifications.find((n) => n.idempotencyKey.includes(":resend:"));
    expect(resendRow?.state).toBe("failed");
  });

  it("link_generation_failed still resolves the claimed ledger row to 'failed' — same reasoning as no_email_on_file above", async () => {
    const fakeScheduling = createFakeSchedulingRepository();
    const visitId = await seedCompletedConfirmedVisit(fakeScheduling);
    const fakeAuthLink = createFakeCustomerAuthLinkGenerator({ behavior: () => ({ ok: false, reason: "simulated failure" }) });
    const fakeEmail = createFakeEmailSender();

    await requestFreshPaymentLink(
      { repo: fakeScheduling.repo, contactLookup: async () => CONTACT, authLinkGenerator: fakeAuthLink.generator, emailSender: fakeEmail.sender },
      visitId
    );

    const notifications = await fakeScheduling.repo.listServiceVisitNotifications(visitId);
    const resendRow = notifications.find((n) => n.idempotencyKey.includes(":resend:"));
    expect(resendRow?.state).toBe("failed");
  });

  it("provider-accepted-but-response-timed-out: a retry with the SAME idempotency key and the SAME payload that receives the provider's replayed success is treated as a clean 'sent' — never a second physical email, never an ambiguous state", async () => {
    const fakeScheduling = createFakeSchedulingRepository();
    const visitId = await seedCompletedConfirmedVisit(fakeScheduling);
    const seenIdempotencyKeys: string[] = [];
    const seenPayloads: string[] = [];
    const timeoutThenReplayEmail = createFakeEmailSender({
      behavior: (input, callNumber) => {
        seenIdempotencyKeys.push(input.idempotencyKey);
        seenPayloads.push(input.html);
        if (callNumber === 1) {
          // The provider actually processed and queued the email — our own
          // HTTP call just never got the response back.
          return { sent: false, failureReason: "ETIMEDOUT: response timed out after the request was sent" };
        }
        // Resend recognizes the repeated Idempotency-Key as the same
        // request and returns the ORIGINAL send's result — same
        // providerMessageId both times, never a second real email.
        return { sent: true, providerMessageId: "resend-original-message-id" };
      },
    });
    const deps = buildDeps(fakeScheduling);

    const result = await requestFreshPaymentLink({ ...deps, emailSender: timeoutThenReplayEmail.sender }, visitId);

    expect(result).toEqual({ ok: true });
    // Exactly one distinct idempotency key and one distinct payload across
    // both attempts — nothing was regenerated or varied for the retry.
    expect(new Set(seenIdempotencyKeys).size).toBe(1);
    expect(new Set(seenPayloads).size).toBe(1);
    const notifications = await fakeScheduling.repo.listServiceVisitNotifications(visitId);
    const resendRow = notifications.find((n) => n.idempotencyKey.includes(":resend:"));
    expect(resendRow?.state).toBe("sent");
  });

  it("durable recovery: after the three immediate attempts are exhausted, the terminal-failed row is eligible for the EXISTING generic admin retry, which the EXISTING cron claim can then pick up and send via the normal path", async () => {
    const fakeScheduling = createFakeSchedulingRepository();
    const visitId = await seedCompletedConfirmedVisit(fakeScheduling);
    const deps = buildDeps(fakeScheduling);
    const failingEmail = createFakeEmailSender({ behavior: () => ({ sent: false, failureReason: "simulated outage" }) });

    await requestFreshPaymentLink({ ...deps, emailSender: failingEmail.sender }, visitId);
    const afterAttempts = await fakeScheduling.repo.listServiceVisitNotifications(visitId);
    const resendRow = afterAttempts.find((n) => n.idempotencyKey.includes(":resend:"))!;
    expect(resendRow.state).toBe("failed");

    // The SAME generic mechanism every other notification type already
    // uses — no special-casing required for this row to work with it.
    await fakeScheduling.repo.retryFailedServiceVisitNotification(resendRow.id);
    const afterRetryReset = (await fakeScheduling.repo.findServiceVisitNotificationById(resendRow.id))!;
    expect(afterRetryReset.state).toBe("pending");

    // The cron's own atomic claim (the SAME one dispatch-due-notifications.ts
    // calls) can now legitimately pick it up — proving no special-casing
    // this function introduced has made the row incompatible with the
    // normal durable path.
    const claimed = await fakeScheduling.repo.claimDueServiceVisitNotifications(25, 10);
    expect(claimed.map((n) => n.id)).toContain(resendRow.id);
  });

  describe("concurrency — real races, not just sequential repeats", () => {
    it("two TRULY simultaneous resend requests for the SAME visit: exactly one succeeds, the other is rejected as a duplicate — never two emails", async () => {
      const fakeScheduling = createFakeSchedulingRepository();
      const visitId = await seedCompletedConfirmedVisit(fakeScheduling);
      const deps = buildDeps(fakeScheduling);

      // Promise.all starts both calls before either's first await resolves —
      // this is what actually exercises the race, not two sequential awaits.
      const [first, second] = await Promise.all([requestFreshPaymentLink(deps, visitId), requestFreshPaymentLink(deps, visitId)]);

      const outcomes = [first, second].sort((a, b) => Number(b.ok) - Number(a.ok));
      expect(outcomes[0]).toEqual({ ok: true });
      expect(outcomes[1]).toEqual({ ok: false, reason: "duplicate_request" });
      expect(deps.emailState.sentEmails).toHaveLength(1);
    });

    it("an admin resend and a customer resend firing at the same instant for the same visit: still exactly one send — the atomic claim doesn't care which caller it was", async () => {
      const fakeScheduling = createFakeSchedulingRepository();
      const visitId = await seedCompletedConfirmedVisit(fakeScheduling);
      const adminDeps = buildDeps(fakeScheduling);
      // A separate "customer" caller sharing the same repo/visit, as if the
      // admin action and the customer's own resend page both fired at once.
      const customerEmail = createFakeEmailSender();
      const customerAuthLink = createFakeCustomerAuthLinkGenerator();

      const [adminResult, customerResult] = await Promise.all([
        requestFreshPaymentLink(adminDeps, visitId),
        requestFreshPaymentLink(
          { repo: fakeScheduling.repo, contactLookup: async () => CONTACT, authLinkGenerator: customerAuthLink.generator, emailSender: customerEmail.sender, sleep: NO_WAIT },
          visitId
        ),
      ]);

      const succeeded = [adminResult, customerResult].filter((r) => r.ok);
      expect(succeeded).toHaveLength(1);
      const totalSent = adminDeps.emailState.sentEmails.length + customerEmail.state.sentEmails.length;
      expect(totalSent).toBe(1);
    });

    it("4 truly simultaneous resend requests for the same visit: at most 3 succeed — the rate limit holds under real concurrency, not just sequential calls", async () => {
      const fakeScheduling = createFakeSchedulingRepository();
      const visitId = await seedCompletedConfirmedVisit(fakeScheduling);
      // Each concurrent caller needs ITS OWN clock offset — real distinct
      // callers wouldn't literally share one Date instance, and a shared
      // fixed `now` would make every attempt collide as a duplicate instead
      // of exercising the rate limit specifically. Staggered well past the
      // 30s duplicate-cooldown (so duplicate protection doesn't mask the
      // rate limit) but all still within the 1h rate-limit window.
      const calls = [0, 1, 2, 3].map((i) =>
        requestFreshPaymentLink(
          {
            repo: fakeScheduling.repo,
            contactLookup: async () => CONTACT,
            authLinkGenerator: createFakeCustomerAuthLinkGenerator().generator,
            emailSender: createFakeEmailSender().sender,
            now: () => new Date(Date.parse("2026-10-14T00:00:00Z") + i * 40_000),
            sleep: NO_WAIT,
          },
          visitId
        )
      );

      const results = await Promise.all(calls);

      const succeeded = results.filter((r) => r.ok);
      const rateLimited = results.filter((r) => !r.ok && r.reason === "rate_limited");
      expect(succeeded.length).toBeLessThanOrEqual(RATE_LIMIT_MAX_ATTEMPTS_FOR_TEST);
      expect(succeeded.length + rateLimited.length).toBe(4);
    });
  });

  describe("cron overlap", () => {
    it("a row created by this function is never returned by the cron's own atomic claim — categorically, by starting in 'sending', not merely because the timing usually doesn't overlap", async () => {
      const fakeScheduling = createFakeSchedulingRepository();
      const visitId = await seedCompletedConfirmedVisit(fakeScheduling);
      const deps = buildDeps(fakeScheduling);

      await requestFreshPaymentLink(deps, visitId);

      // Even with a generous stale-claim window, a healthy 'sent' (or, in a
      // slow-but-not-stale case, 'sending') row from this function must
      // never be something the cron's claim considers due.
      const claimed = await fakeScheduling.repo.claimDueServiceVisitNotifications(25, 0);
      const notifications = await fakeScheduling.repo.listServiceVisitNotifications(visitId);
      const resendRow = notifications.find((n) => n.idempotencyKey.includes(":resend:"))!;
      expect(claimed.map((n) => n.id)).not.toContain(resendRow.id);
    });

    it("cron claim running concurrently with a resend for the SAME visit's unrelated pending reminder notification: the two don't interfere with each other", async () => {
      const fakeScheduling = createFakeSchedulingRepository();
      const visitId = await seedCompletedConfirmedVisit(fakeScheduling);
      const deps = buildDeps(fakeScheduling);
      // An unrelated, genuinely cron-due row for the same visit (e.g. a
      // 24h reminder) — must be claimable by the cron regardless of what
      // the resend path is doing concurrently for the SAME visit.
      await fakeScheduling.repo.insertServiceVisitNotification({
        serviceVisitId: visitId,
        customerId: "customer-1",
        notificationType: "reminder_24h",
        channel: "email",
        scheduledSendAt: new Date(),
        idempotencyKey: `customer-1:${visitId}:reminder_24h:email:v1`,
      });

      const [, claimed] = await Promise.all([requestFreshPaymentLink(deps, visitId), fakeScheduling.repo.claimDueServiceVisitNotifications(25, 10)]);

      expect(claimed.some((n) => n.notificationType === "reminder_24h")).toBe(true);
    });
  });
});
