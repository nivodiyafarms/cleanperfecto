import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CustomerContactPatch, CustomerRecord, NewCustomerInput } from "./customer-repository";
import type { InsertQuoteRequestResult, InstantQuoteRepository } from "./repository";
import type { QuoteRequestRow } from "./build-quote-request-row";
import type { InstantQuoteAdminNotificationSummary, InstantQuoteCustomerEmailResult, InstantQuoteEmailSender } from "./email/sender";
import type { InstantQuoteEmailDetails } from "./email/build-email-details";
import type { InstantQuoteRawInput } from "./types";

vi.mock("./supabase-repository", () => ({
  createSupabaseInstantQuoteRepository: vi.fn(),
}));
vi.mock("./email/resend-instant-quote-email-sender", () => ({
  createResendInstantQuoteEmailSender: vi.fn(),
}));

const { createSupabaseInstantQuoteRepository } = await import("./supabase-repository");
const { createResendInstantQuoteEmailSender } = await import("./email/resend-instant-quote-email-sender");
const { submitInstantQuoteRequest } = await import("./submit-instant-quote-request");

interface FakeVisit {
  customerId: string;
  status: "scheduled" | "completed" | "cancelled";
  serviceAddressIdentity: string | null;
}

class FakeInstantQuoteRepository implements InstantQuoteRepository {
  customers: CustomerRecord[] = [];
  visits: FakeVisit[] = [];
  insertedRows: QuoteRequestRow[] = [];
  private nextCustomerId = 1;
  insertShouldFail = false;

  async findByEmailNormalized(emailNormalized: string): Promise<CustomerRecord[]> {
    return this.customers.filter((c) => c.emailNormalized === emailNormalized);
  }

  async findByPhoneNormalized(phoneNormalized: string): Promise<CustomerRecord[]> {
    return this.customers.filter((c) => c.phoneNormalized === phoneNormalized);
  }

  async createCustomer(input: NewCustomerInput): Promise<CustomerRecord> {
    const customer: CustomerRecord = { id: `customer-${this.nextCustomerId++}`, ...input };
    this.customers.push(customer);
    return customer;
  }

  async updateCustomerContact(customerId: string, patch: CustomerContactPatch): Promise<void> {
    const customer = this.customers.find((c) => c.id === customerId);
    if (!customer) return;
    Object.assign(customer, {
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.email !== undefined ? { email: patch.email } : {}),
      ...(patch.emailNormalized !== undefined ? { emailNormalized: patch.emailNormalized } : {}),
      ...(patch.phone !== undefined ? { phone: patch.phone } : {}),
      ...(patch.phoneNormalized !== undefined ? { phoneNormalized: patch.phoneNormalized } : {}),
    });
  }

  async hasCompletedVisitByEmail(emailNormalized: string): Promise<boolean> {
    const ids = this.customers.filter((c) => c.emailNormalized === emailNormalized).map((c) => c.id);
    return this.visits.some((v) => v.status === "completed" && ids.includes(v.customerId));
  }

  async hasCompletedVisitByPhone(phoneNormalized: string): Promise<boolean> {
    const ids = this.customers.filter((c) => c.phoneNormalized === phoneNormalized).map((c) => c.id);
    return this.visits.some((v) => v.status === "completed" && ids.includes(v.customerId));
  }

  async hasCompletedVisitByAddress(serviceAddressIdentity: string): Promise<boolean> {
    return this.visits.some((v) => v.status === "completed" && v.serviceAddressIdentity === serviceAddressIdentity);
  }

  async insertQuoteRequest(row: QuoteRequestRow): Promise<InsertQuoteRequestResult> {
    if (this.insertShouldFail) {
      return { ok: false, error: "simulated insert failure" };
    }
    this.insertedRows.push(row);
    return { ok: true };
  }
}

class FakeEmailSender implements InstantQuoteEmailSender {
  adminCalls: InstantQuoteEmailDetails[] = [];
  customerCalls: InstantQuoteEmailDetails[] = [];
  adminShouldThrow = false;
  adminResult: InstantQuoteAdminNotificationSummary = { configured: true, attempted: 1, sent: 1 };
  customerShouldThrow = false;
  customerResult: InstantQuoteCustomerEmailResult = { attempted: true, sent: true };

  async sendAdminNotification(details: InstantQuoteEmailDetails): Promise<InstantQuoteAdminNotificationSummary> {
    this.adminCalls.push(details);
    if (this.adminShouldThrow) throw new Error("admin email provider down");
    return this.adminResult;
  }

  async sendCustomerConfirmation(details: InstantQuoteEmailDetails): Promise<InstantQuoteCustomerEmailResult> {
    this.customerCalls.push(details);
    if (this.customerShouldThrow) throw new Error("customer email provider down");
    return this.customerResult;
  }
}

function rawInput(overrides: Partial<InstantQuoteRawInput> = {}): InstantQuoteRawInput {
  return {
    propertyType: "home",
    cleaningType: "standard",
    condition: "light",
    rooms: { bedrooms: 1, fullBathrooms: 1, halfBathrooms: 0 },
    frequency: "one_time",
    isPrepaidPackage: false,
    visitCount: 1,
    addOnIds: [],
    name: "Jane Customer",
    phone: "469-555-0100",
    email: "jane@example.com",
    serviceAddress: { line1: "123 Main St", city: "Frisco", state: "TX", zip: "75056" },
    ...overrides,
  };
}

let repo: FakeInstantQuoteRepository;
let emailSender: FakeEmailSender;

beforeEach(() => {
  repo = new FakeInstantQuoteRepository();
  emailSender = new FakeEmailSender();
  vi.mocked(createSupabaseInstantQuoteRepository).mockReturnValue(repo);
  vi.mocked(createResendInstantQuoteEmailSender).mockReturnValue(emailSender);
});

describe("submitInstantQuoteRequest", () => {
  it("returns a validation failure and never touches persistence or email for invalid input", async () => {
    const result = await submitInstantQuoteRequest(rawInput({ email: "not-an-email", phone: undefined }));
    expect(result).toMatchObject({ success: false, stage: "validation" });
    expect(repo.insertedRows).toHaveLength(0);
    expect(emailSender.adminCalls).toHaveLength(0);
  });

  it("a valid automatic instant quote persists and returns a customer-safe automatic-estimate result", async () => {
    const result = await submitInstantQuoteRequest(rawInput());
    expect(result.success).toBe(true);
    if (result.success && result.estimateType === "instant_range") {
      expect(result.displayRangeLower).toBeGreaterThan(0);
      expect(result.firstCleaningOfferApplied).toBe(true); // first-time customer at launch
    } else {
      throw new Error("expected instant_range");
    }
    expect(repo.insertedRows).toHaveLength(1);
  });

  it("a manual-review quote (manual-review ZIP) persists and returns a customer-safe manual-review result", async () => {
    const result = await submitInstantQuoteRequest(
      rawInput({ serviceAddress: { line1: "1 Far Rd", zip: "75054" } })
    );
    expect(result).toMatchObject({
      success: true,
      estimateType: "manual_review",
      manualReviewRequired: true,
      reasonCode: "custom_quote_required",
    });
    expect(repo.insertedRows).toHaveLength(1);
  });

  it("a returning customer with completed history does not get the first-cleaning offer", async () => {
    const customer = await repo.createCustomer({
      name: "Jane Customer",
      email: "jane@example.com",
      emailNormalized: "jane@example.com",
      phone: "+14695550100",
      phoneNormalized: "+14695550100",
    });
    repo.visits.push({ customerId: customer.id, status: "completed", serviceAddressIdentity: null });

    const result = await submitInstantQuoteRequest(rawInput());
    expect(result.success).toBe(true);
    if (result.success && result.estimateType === "instant_range") {
      expect(result.firstCleaningOfferApplied).toBe(false);
    } else {
      throw new Error("expected instant_range");
    }
  });

  it("an identity-conflict quote still persists and returns the same safe manual-review shape, with no conflict details", async () => {
    await repo.createCustomer({
      name: "Customer A",
      email: "jane@example.com",
      emailNormalized: "jane@example.com",
      phone: "+14695551111",
      phoneNormalized: "+14695551111",
    });
    await repo.createCustomer({
      name: "Customer B",
      email: "other@example.com",
      emailNormalized: "other@example.com",
      phone: "+14695550100",
      phoneNormalized: "+14695550100",
    });

    const result = await submitInstantQuoteRequest(rawInput());
    expect(result).toMatchObject({ success: true, estimateType: "manual_review", reasonCode: "custom_quote_required" });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("customer-1");
    expect(serialized).not.toContain("customer-2");
    expect(serialized).not.toContain("CUSTOMER_IDENTITY_CONFLICT");
    expect(repo.insertedRows[0].customer_id).toBeNull();
  });

  it("does not attempt a customer email when no email was supplied, but still attempts admin notification", async () => {
    await submitInstantQuoteRequest(rawInput({ email: undefined }));
    expect(emailSender.customerCalls).toHaveLength(0);
    expect(emailSender.adminCalls).toHaveLength(1);
  });

  it("attempts a customer email when an email was supplied", async () => {
    await submitInstantQuoteRequest(rawInput());
    expect(emailSender.customerCalls).toHaveLength(1);
    expect(emailSender.customerCalls[0].email).toBe("jane@example.com");
  });

  it("admin email is attempted after persistence, built from the persisted quote's own id", async () => {
    await submitInstantQuoteRequest(rawInput());
    expect(emailSender.adminCalls).toHaveLength(1);
    expect(emailSender.adminCalls[0].quoteId).toBe(repo.insertedRows[0].id);
  });

  it("customer email is attempted after persistence, built from the persisted quote's own id", async () => {
    await submitInstantQuoteRequest(rawInput());
    expect(emailSender.customerCalls[0].quoteId).toBe(repo.insertedRows[0].id);
  });

  it("persistence failure sends no email at all", async () => {
    repo.insertShouldFail = true;
    const result = await submitInstantQuoteRequest(rawInput());
    expect(result).toEqual({ success: false, stage: "failed", message: expect.any(String) });
    expect(emailSender.adminCalls).toHaveLength(0);
    expect(emailSender.customerCalls).toHaveLength(0);
  });

  it("persistence failure never exposes the internal database error to the customer", async () => {
    repo.insertShouldFail = true;
    const result = await submitInstantQuoteRequest(rawInput());
    expect(JSON.stringify(result)).not.toContain("simulated insert failure");
  });

  it("admin email failure after a persisted quote still returns a successful response", async () => {
    emailSender.adminShouldThrow = true;
    const result = await submitInstantQuoteRequest(rawInput());
    expect(result.success).toBe(true);
    expect(repo.insertedRows).toHaveLength(1);
  });

  it("customer email failure after a persisted quote still returns a successful response", async () => {
    emailSender.customerResult = { attempted: true, sent: false };
    const result = await submitInstantQuoteRequest(rawInput());
    expect(result.success).toBe(true);
  });

  it("both email failures still leave the persisted quote succeeding with a safe response", async () => {
    emailSender.adminShouldThrow = true;
    emailSender.customerShouldThrow = true;
    const result = await submitInstantQuoteRequest(rawInput());
    expect(result.success).toBe(true);
    expect(repo.insertedRows).toHaveLength(1);
  });

  it("the customer-safe result never contains a customer UUID", async () => {
    const result = await submitInstantQuoteRequest(rawInput());
    expect(JSON.stringify(result)).not.toMatch(/customer-\d/);
  });

  it("the customer-safe result never contains a pricing_snapshot or database column names", async () => {
    const result = await submitInstantQuoteRequest(rawInput());
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("pricing_snapshot");
    expect(serialized).not.toContain("calculated_total");
    expect(serialized).not.toContain("service_address_identity");
  });

  it("ignores hostile authoritative fields smuggled into the raw payload", async () => {
    const hostile = {
      ...rawInput(),
      calculatedTotal: 1,
      entryChannel: "admin",
      asOf: new Date("2020-01-01"),
      customerId: "attacker-controlled-id",
      firstCleaningEligible: true,
    } as InstantQuoteRawInput & Record<string, unknown>;

    const result = await submitInstantQuoteRequest(hostile);
    expect(result.success).toBe(true);
    if (result.success && result.estimateType === "instant_range") {
      expect(result.displayRangeLower).not.toBe(1);
    }
    expect(repo.insertedRows[0].entry_channel).toBe("website");
    expect(repo.insertedRows[0].customer_id).not.toBe("attacker-controlled-id");
  });

  it("entry_channel on the persisted row is always 'website'", async () => {
    await submitInstantQuoteRequest(rawInput());
    expect(repo.insertedRows[0].entry_channel).toBe("website");
  });

  it("the server clock controls which first-cleaning offer applies — never a value the wrapper takes from the caller", async () => {
    // submitInstantQuoteRequest takes no asOf parameter at all; this test
    // simply documents that the production call path always omits asOf so
    // submitInstantQuote falls back to `new Date()`.
    const result = await submitInstantQuoteRequest(rawInput());
    expect(result.success).toBe(true);
    // No asOf-shaped parameter exists on submitInstantQuoteRequest's signature — a compile-time guarantee, not just runtime.
    expect(submitInstantQuoteRequest.length).toBe(1);
  });

  it("repository creation failure returns a generic customer-safe failure without throwing", async () => {
    vi.mocked(createSupabaseInstantQuoteRepository).mockImplementationOnce(() => {
      throw new Error("Missing SUPABASE_SECRET_KEY");
    });
    const result = await submitInstantQuoteRequest(rawInput());
    expect(result).toEqual({ success: false, stage: "failed", message: expect.any(String) });
    expect(JSON.stringify(result)).not.toContain("SUPABASE_SECRET_KEY");
  });
});
