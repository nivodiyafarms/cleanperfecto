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

function buildDeps(fakeScheduling: ReturnType<typeof createFakeSchedulingRepository>, overrides?: Partial<{ contact: NotificationRecipientContact | null }>) {
  const email = createFakeEmailSender();
  const authLink = createFakeCustomerAuthLinkGenerator();
  return {
    repo: fakeScheduling.repo,
    contactLookup: async () => overrides?.contact ?? CONTACT,
    authLinkGenerator: authLink.generator,
    emailSender: email.sender,
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

  it("is NOT routed through the notification ledger — two resend requests in a row both send, never deduped by (visit, amount)", async () => {
    const fakeScheduling = createFakeSchedulingRepository();
    const visitId = await seedCompletedConfirmedVisit(fakeScheduling);
    const deps = buildDeps(fakeScheduling);

    await requestFreshPaymentLink(deps, visitId);
    await requestFreshPaymentLink(deps, visitId);

    expect(deps.emailState.sentEmails).toHaveLength(2);
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

  it("returns send_failed when the email provider fails, after a real link was generated", async () => {
    const fakeScheduling = createFakeSchedulingRepository();
    const visitId = await seedCompletedConfirmedVisit(fakeScheduling);
    const deps = buildDeps(fakeScheduling);
    const failingEmail = createFakeEmailSender({ behavior: () => ({ sent: false, failureReason: "simulated provider failure" }) });

    const result = await requestFreshPaymentLink({ ...deps, emailSender: failingEmail.sender }, visitId);

    expect(result).toEqual({ ok: false, reason: "send_failed" });
  });
});
