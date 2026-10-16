import { describe, expect, it } from "vitest";
import type { CustomerRecord, NewCustomerInput } from "./customer-repository";
import { computeAgreedQuoteReferenceTotal, createAgreedQuote, type CreateAgreedQuoteInput } from "./create-agreed-quote";
import type { AgreedQuoteInvitationRepository, AgreedQuoteInvitationRow, NewAgreedQuoteInvitationRow } from "./agreed-quote-invitation-repository";
import type { InstantQuoteRepository } from "./repository";
import type { QuoteRequestRow } from "./build-quote-request-row";

function fakeInstantQuoteRepo(customers: CustomerRecord[] = []): InstantQuoteRepository & { insertedRows: QuoteRequestRow[] } {
  const store = [...customers];
  const insertedRows: QuoteRequestRow[] = [];
  let nextId = store.length + 1;
  return {
    insertedRows,
    async findByEmailNormalized(emailNormalized) {
      return store.filter((c) => c.emailNormalized === emailNormalized);
    },
    async findByPhoneNormalized(phoneNormalized) {
      return store.filter((c) => c.phoneNormalized === phoneNormalized);
    },
    async createCustomer(input: NewCustomerInput) {
      const record: CustomerRecord = { id: `customer-${nextId++}`, ...input };
      store.push(record);
      return record;
    },
    async updateCustomerContact(customerId, patch) {
      const customer = store.find((c) => c.id === customerId);
      if (customer) Object.assign(customer, patch);
    },
    async hasCompletedVisitByEmail() {
      return false;
    },
    async hasCompletedVisitByPhone() {
      return false;
    },
    async hasCompletedVisitByAddress() {
      return false;
    },
    async insertQuoteRequest(row) {
      insertedRows.push(row);
      return { ok: true };
    },
  };
}

function fakeInvitationRepo(): AgreedQuoteInvitationRepository & { rows: AgreedQuoteInvitationRow[] } {
  const rows: AgreedQuoteInvitationRow[] = [];
  let nextId = 1;
  return {
    rows,
    async insertAgreedQuoteInvitation(row: NewAgreedQuoteInvitationRow) {
      const now = new Date().toISOString();
      const created: AgreedQuoteInvitationRow = {
        id: `invitation-${nextId++}`,
        quoteRequestId: row.quoteRequestId,
        customerId: row.customerId,
        createdByAdminUserId: row.createdByAdminUserId,
        status: "pending_send",
        clientRequestId: row.clientRequestId,
        negotiationChannel: row.negotiationChannel,
        negotiationNotes: row.negotiationNotes,
        agreedRequestedDate: row.agreedRequestedDate,
        agreedRequestedStartTime: row.agreedRequestedStartTime,
        resendCount: 0,
        lastSentAt: null,
        expiresAt: row.expiresAt,
        renewCount: 0,
        renewedAt: null,
        renewedByAdminUserId: null,
        supersedesInvitationId: row.supersedesInvitationId,
        supersededAt: null,
        bookingOrderId: null,
        checkoutStartedAt: null,
        completedAt: null,
        cancelledAt: null,
        cancelledByAdminUserId: null,
        createdAt: now,
        updatedAt: now,
      };
      rows.push(created);
      return created;
    },
    async findAgreedQuoteInvitationById(id) {
      return rows.find((r) => r.id === id) ?? null;
    },
    async findAgreedQuoteInvitationSummaryById() {
      throw new Error("not used in these tests");
    },
    async listAgreedQuoteInvitationSummaries() {
      throw new Error("not used in these tests");
    },
    async supersedeAgreedQuoteInvitation(oldInvitationId: string) {
      const row = rows.find((r) => r.id === oldInvitationId);
      if (!row || !["pending_send", "sent"].includes(row.status)) return null;
      row.status = "superseded";
      row.supersededAt = new Date().toISOString();
      return row;
    },
    async claimAgreedQuoteInvitationSend() {
      throw new Error("not used in these tests");
    },
    async markAgreedQuoteInvitationSendSent() {},
    async markAgreedQuoteInvitationSendFailedTerminal() {},
    async recordAgreedQuoteInvitationSent() {},
    async renewAgreedQuoteInvitation() {
      throw new Error("not used in these tests");
    },
    async linkAgreedQuoteInvitationBookingOrder() {
      throw new Error("not used in these tests");
    },
    async claimAgreedQuoteInvitationCheckout() {
      throw new Error("not used in these tests");
    },
    async claimAgreedQuoteInvitationCancellation() {
      throw new Error("not used in these tests");
    },
    async markAgreedQuoteInvitationCompletedByBookingOrderId() {},
    async hasLivePaymentAttemptForBookingOrder() {
      return false;
    },
  };
}

function baseAgreedQuoteInput(overrides: Partial<CreateAgreedQuoteInput> = {}): CreateAgreedQuoteInput {
  return {
    customerContact: { name: "Jordan Lee", email: "jordan@example.com", phone: "2145551234" },
    propertyType: "home",
    cleaningType: "standard",
    condition: "moderate",
    rooms: { bedrooms: 2, fullBathrooms: 2, halfBathrooms: 0 },
    serviceAddress: { line1: "123 Main St", zip: "75056" },
    frequency: "one_time",
    isPrepaidPackage: false,
    visitCount: 1,
    addOnIds: [],
    agreedTotal: 300,
    createdByAdminUserId: "admin-1",
    ...overrides,
  };
}

describe("createAgreedQuote", () => {
  it("creates a new customer, a quote_requests row, and an invitation when no match exists", async () => {
    const repo = fakeInstantQuoteRepo();
    const invitationRepo = fakeInvitationRepo();

    const result = await createAgreedQuote(repo, invitationRepo, baseAgreedQuoteInput(), new Date("2026-10-16T00:00:00Z"));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(repo.insertedRows).toHaveLength(1);
    expect(repo.insertedRows[0].entry_channel).toBe("admin");
    expect(repo.insertedRows[0].estimate_type).toBe("instant_range");
    expect(repo.insertedRows[0].calculated_total).toBe(300);
    expect(invitationRepo.rows).toHaveLength(1);
    expect(invitationRepo.rows[0].status).toBe("pending_send");
    expect(invitationRepo.rows[0].customerId).toBe(result.customerId);
  });

  it("reuses an existing customer matched by email, never creating a duplicate", async () => {
    const existing: CustomerRecord = {
      id: "customer-existing",
      name: "Jordan Lee",
      email: "jordan@example.com",
      emailNormalized: "jordan@example.com",
      phone: null,
      phoneNormalized: null,
    };
    const repo = fakeInstantQuoteRepo([existing]);
    const invitationRepo = fakeInvitationRepo();

    const result = await createAgreedQuote(repo, invitationRepo, baseAgreedQuoteInput(), new Date());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.customerId).toBe("customer-existing");
  });

  it("hard-stops on a customer identity conflict rather than proceeding with a null customer", async () => {
    const customerA: CustomerRecord = { id: "a", name: "A", email: "a@example.com", emailNormalized: "a@example.com", phone: null, phoneNormalized: "+12145551234" };
    const customerB: CustomerRecord = { id: "b", name: "B", email: "b@example.com", emailNormalized: "jordan@example.com", phone: null, phoneNormalized: null };
    const repo = fakeInstantQuoteRepo([customerA, customerB]);
    const invitationRepo = fakeInvitationRepo();

    const result = await createAgreedQuote(
      repo,
      invitationRepo,
      baseAgreedQuoteInput({ customerContact: { name: "Jordan", email: "jordan@example.com", phone: "2145551234" } }),
      new Date()
    );

    expect(result).toMatchObject({ ok: false, stage: "customer_conflict" });
    expect(repo.insertedRows).toHaveLength(0);
    expect(invitationRepo.rows).toHaveLength(0);
  });

  it("rejects when neither an existing customer nor contact details are supplied", async () => {
    const repo = fakeInstantQuoteRepo();
    const invitationRepo = fakeInvitationRepo();
    const result = await createAgreedQuote(repo, invitationRepo, baseAgreedQuoteInput({ customerContact: undefined }), new Date());
    expect(result).toMatchObject({ ok: false, stage: "validation" });
  });

  it("rejects a non-positive agreed total", async () => {
    const repo = fakeInstantQuoteRepo();
    const invitationRepo = fakeInvitationRepo();
    const result = await createAgreedQuote(repo, invitationRepo, baseAgreedQuoteInput({ agreedTotal: 0 }), new Date());
    expect(result).toMatchObject({ ok: false, stage: "validation" });
  });

  it("supersedes the old invitation on a revise, and fails safely if the old one is no longer supersedable", async () => {
    const repo = fakeInstantQuoteRepo();
    const invitationRepo = fakeInvitationRepo();
    const first = await createAgreedQuote(repo, invitationRepo, baseAgreedQuoteInput(), new Date());
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const fakeFindCustomerContact = async (customerId: string) => ({ id: customerId, name: "Jordan Lee", email: "jordan@example.com", phone: "+12145551234" });

    const revised = await createAgreedQuote(
      repo,
      invitationRepo,
      baseAgreedQuoteInput({ existingCustomerId: first.customerId, customerContact: undefined, agreedTotal: 275, supersedesInvitationId: first.invitationId }),
      new Date(),
      fakeFindCustomerContact
    );
    expect(revised.ok).toBe(true);
    const oldInvitation = invitationRepo.rows.find((r) => r.id === first.invitationId);
    expect(oldInvitation?.status).toBe("superseded");

    // Old one is now superseded — a second revise attempt against it is refused.
    const secondRevise = await createAgreedQuote(
      repo,
      invitationRepo,
      baseAgreedQuoteInput({ existingCustomerId: first.customerId, customerContact: undefined, agreedTotal: 260, supersedesInvitationId: first.invitationId }),
      new Date(),
      fakeFindCustomerContact
    );
    expect(secondRevise).toMatchObject({ ok: false, stage: "supersede_failed" });
  });
});

describe("computeAgreedQuoteReferenceTotal", () => {
  it("returns the engine's own total for an ordinary scope", () => {
    const total = computeAgreedQuoteReferenceTotal(baseAgreedQuoteInput({ agreedTotal: 999 /* irrelevant to the reference calc */ }), new Date("2026-10-16T00:00:00Z"));
    expect(total).not.toBeNull();
    expect(total).toBeGreaterThan(0);
  });

  it("returns null when the engine itself would require manual review for this scope", () => {
    const total = computeAgreedQuoteReferenceTotal(
      baseAgreedQuoteInput({ propertyType: "restaurant", agreedTotal: 500 }),
      new Date("2026-10-16T00:00:00Z")
    );
    expect(total).toBeNull();
  });
});
