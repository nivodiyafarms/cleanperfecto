import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CustomerContactPatch, CustomerRecord, NewCustomerInput } from "./customer-repository";
import type { InsertQuoteRequestResult, InstantQuoteRepository } from "./repository";
import type { QuoteRequestRow } from "./build-quote-request-row";
import type { InstantQuoteRawInput } from "./types";

vi.mock("./supabase-repository", () => ({
  createSupabaseInstantQuoteRepository: vi.fn(),
}));

const { createSupabaseInstantQuoteRepository } = await import("./supabase-repository");
const { previewInstantQuoteCustomization } = await import("./preview-instant-quote-customization");

interface FakeVisit {
  customerId: string;
  status: "scheduled" | "completed" | "cancelled";
  serviceAddressIdentity: string | null;
}

class FakeInstantQuoteRepository implements InstantQuoteRepository {
  customers: CustomerRecord[] = [];
  visits: FakeVisit[] = [];
  insertedRows: QuoteRequestRow[] = [];
  createCustomerCalls = 0;
  updateCustomerContactCalls = 0;
  insertQuoteRequestCalls = 0;

  async findByEmailNormalized(emailNormalized: string): Promise<CustomerRecord[]> {
    return this.customers.filter((c) => c.emailNormalized === emailNormalized);
  }

  async findByPhoneNormalized(phoneNormalized: string): Promise<CustomerRecord[]> {
    return this.customers.filter((c) => c.phoneNormalized === phoneNormalized);
  }

  async createCustomer(input: NewCustomerInput): Promise<CustomerRecord> {
    this.createCustomerCalls += 1;
    const customer: CustomerRecord = { id: "customer-1", ...input };
    this.customers.push(customer);
    return customer;
  }

  async updateCustomerContact(customerId: string, patch: CustomerContactPatch): Promise<void> {
    void customerId;
    void patch;
    this.updateCustomerContactCalls += 1;
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
    this.insertQuoteRequestCalls += 1;
    this.insertedRows.push(row);
    return { ok: true };
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

beforeEach(() => {
  repo = new FakeInstantQuoteRepository();
  vi.mocked(createSupabaseInstantQuoteRepository).mockReturnValue(repo);
});

describe("previewInstantQuoteCustomization", () => {
  it("returns a validation failure for invalid input without touching the repository", async () => {
    const result = await previewInstantQuoteCustomization(rawInput({ email: "bad", phone: undefined }));
    expect(result).toMatchObject({ success: false, stage: "validation" });
    expect(createSupabaseInstantQuoteRepository).not.toHaveBeenCalled();
  });

  it("returns an automatic estimate reflecting an added fixed add-on", async () => {
    const result = await previewInstantQuoteCustomization(rawInput({ addOnIds: ["inside_oven"] }));
    expect(result.success).toBe(true);
    if (result.success && result.estimateType === "instant_range") {
      expect(result.displayRangeLower).toBeGreaterThan(0);
    } else {
      throw new Error("expected instant_range");
    }
  });

  it("never creates a customer", async () => {
    await previewInstantQuoteCustomization(rawInput());
    expect(repo.createCustomerCalls).toBe(0);
  });

  it("never updates a customer's contact info, even for a matching existing customer", async () => {
    await repo.createCustomer({
      name: "Jane Customer",
      email: "jane@example.com",
      emailNormalized: "jane@example.com",
      phone: null,
      phoneNormalized: null,
    });
    await previewInstantQuoteCustomization(rawInput());
    expect(repo.updateCustomerContactCalls).toBe(0);
  });

  it("never inserts a quote_request row", async () => {
    await previewInstantQuoteCustomization(rawInput());
    expect(repo.insertQuoteRequestCalls).toBe(0);
    expect(repo.insertedRows).toHaveLength(0);
  });

  it("still uses server-authoritative eligibility for a returning customer, ignoring any smuggled claim", async () => {
    const customer = await repo.createCustomer({
      name: "Jane Customer",
      email: "jane@example.com",
      emailNormalized: "jane@example.com",
      phone: "+14695550100",
      phoneNormalized: "+14695550100",
    });
    repo.visits.push({ customerId: customer.id, status: "completed", serviceAddressIdentity: null });

    const hostile = { ...rawInput(), firstCleaningEligible: true } as InstantQuoteRawInput & {
      firstCleaningEligible: boolean;
    };
    const result = await previewInstantQuoteCustomization(hostile);
    expect(result.success).toBe(true);
    if (result.success && result.estimateType === "instant_range") {
      expect(result.firstCleaningOfferApplied).toBe(false); // real history says not eligible
      expect(result.displayRangeLower).toBe(145); // full undiscounted range — no smuggled eligibility applied
    }
  });

  it("surfaces the regular comparison range when the offer applies", async () => {
    const result = await previewInstantQuoteCustomization(rawInput());
    expect(result.success).toBe(true);
    if (result.success && result.estimateType === "instant_range") {
      expect(result.firstCleaningOfferApplied).toBe(true);
      expect(result.regularDisplayRangeLower).toBe(145);
      expect(result.regularDisplayRangeUpper).toBe(165);
    }
  });

  it("returns a manual-review preview for a manual-review ZIP, without creating a quote", async () => {
    const result = await previewInstantQuoteCustomization(
      rawInput({ serviceAddress: { line1: "1 Far Rd", zip: "75054" } })
    );
    expect(result).toMatchObject({ success: true, estimateType: "manual_review" });
    expect(repo.insertQuoteRequestCalls).toBe(0);
  });

  it("returns a generic customer-safe failure without throwing when repository creation fails", async () => {
    vi.mocked(createSupabaseInstantQuoteRepository).mockImplementationOnce(() => {
      throw new Error("Missing SUPABASE_SECRET_KEY");
    });
    const result = await previewInstantQuoteCustomization(rawInput());
    expect(result).toEqual({ success: false, stage: "failed", message: expect.any(String) });
    expect(JSON.stringify(result)).not.toContain("SUPABASE_SECRET_KEY");
  });

  it("does not persist different rows across repeated preview calls with different add-ons", async () => {
    await previewInstantQuoteCustomization(rawInput({ addOnIds: ["inside_oven"] }));
    await previewInstantQuoteCustomization(rawInput({ addOnIds: ["inside_refrigerator"] }));
    await previewInstantQuoteCustomization(rawInput({ addOnIds: [] }));
    expect(repo.insertQuoteRequestCalls).toBe(0);
    expect(repo.insertedRows).toHaveLength(0);
  });
});
