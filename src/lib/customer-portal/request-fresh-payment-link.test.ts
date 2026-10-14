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
});
