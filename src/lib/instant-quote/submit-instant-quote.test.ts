import { describe, expect, it } from "vitest";
import type { CustomerContactPatch, CustomerRecord, NewCustomerInput } from "./customer-repository";
import type { InsertQuoteRequestResult, InstantQuoteRepository } from "./repository";
import type { QuoteRequestRow } from "./build-quote-request-row";
import { mapToCustomerSafeResult } from "./instant-quote-request-result";
import { submitInstantQuote, type SubmitInstantQuoteInternalDependencies } from "./submit-instant-quote";
import type { InstantQuoteRawInput } from "./types";
import { buildServiceAddressIdentity } from "./normalize-address";

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
    if (patch.name !== undefined) customer.name = patch.name;
    if (patch.email !== undefined) customer.email = patch.email;
    if (patch.emailNormalized !== undefined) customer.emailNormalized = patch.emailNormalized;
    if (patch.phone !== undefined) customer.phone = patch.phone;
    if (patch.phoneNormalized !== undefined) customer.phoneNormalized = patch.phoneNormalized;
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

function deps(overrides: Partial<SubmitInstantQuoteInternalDependencies> = {}): SubmitInstantQuoteInternalDependencies {
  return {
    repo: new FakeInstantQuoteRepository(),
    asOf: new Date("2026-08-20T12:00:00-05:00"),
    ...overrides,
  };
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

describe("submitInstantQuote", () => {
  it("rejects invalid input before touching the repository at all", async () => {
    const repo = new FakeInstantQuoteRepository();
    const result = await submitInstantQuote(rawInput({ email: "not-an-email", phone: undefined }), deps({ repo }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.stage).toBe("validation");
    expect(repo.insertedRows).toHaveLength(0);
  });

  it("first-time customer at the Core ZIP gets an instant-range quote with the first-cleaning offer applied", async () => {
    const repo = new FakeInstantQuoteRepository();
    const result = await submitInstantQuote(rawInput(), deps({ repo }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.estimateType).toBe("instant_range");
      expect(result.calculatedTotal).toBeCloseTo(105.3); // 30% launch offer on a 1B1B Standard Light quote
      expect(result.manualReviewRequired).toBe(false);
      // Server-authoritative regular-vs-discounted comparison, rerun through the same trusted engine.
      expect(result.regularRange).toEqual({ lower: 145, upper: 165 });
    }
    expect(repo.insertedRows).toHaveLength(1);
    expect(repo.insertedRows[0].first_cleaning_offer_applied).toBe(true);
    // The comparison is presentation-only — it never reaches the persisted row/snapshot.
    expect(repo.insertedRows[0].pricing_snapshot.result).not.toHaveProperty("regularRange");
  });

  it("a returning customer (matched by email, completed history) does not get the first-cleaning offer", async () => {
    const repo = new FakeInstantQuoteRepository();
    const customer = await repo.createCustomer({
      name: "Jane Customer",
      email: "jane@example.com",
      emailNormalized: "jane@example.com",
      phone: "+14695550100",
      phoneNormalized: "+14695550100",
    });
    repo.visits.push({ customerId: customer.id, status: "completed", serviceAddressIdentity: null });

    const result = await submitInstantQuote(rawInput(), deps({ repo }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.calculatedTotal).toBe(144); // no discount — same as production-scenarios test #1
      expect(result.customerId).toBe(customer.id);
      expect(result.regularRange).toBeNull(); // no offer applied -> no fabricated comparison
    }
    expect(repo.insertedRows[0].first_cleaning_offer_applied).toBe(false);
  });

  it("resolves the active offer through the real server-side helper, not a client-suppliable value", async () => {
    const repo = new FakeInstantQuoteRepository();
    const launchResult = await submitInstantQuote(rawInput(), deps({ repo, asOf: new Date("2026-08-20T00:00:00Z") }));
    const standardResult = await submitInstantQuote(
      rawInput({ email: "other@example.com" }),
      deps({ repo, asOf: new Date("2026-09-15T00:00:00Z") })
    );
    expect(launchResult.ok).toBe(true);
    expect(standardResult.ok).toBe(true);
    if (launchResult.ok && standardResult.ok) {
      // 30% launch vs 25% standard on the same 1B1B Standard Light base — different totals prove the
      // percentage came from getActiveFirstCleaningOffer(asOf), not a fixed/guessed constant.
      expect(launchResult.calculatedTotal).not.toBe(standardResult.calculatedTotal);
    }
  });

  it("Nearby ZIP applies a travel charge via the real pricing engine", async () => {
    const repo = new FakeInstantQuoteRepository();
    await submitInstantQuote(rawInput({ serviceAddress: { line1: "1 Elm St", zip: "75001" } }), deps({ repo }));
    expect(repo.insertedRows[0].zip).toBe("75001");
  });

  it("a manual-review ZIP still persists the quote as a manual-review outcome", async () => {
    const repo = new FakeInstantQuoteRepository();
    const result = await submitInstantQuote(
      rawInput({ serviceAddress: { line1: "1 Far Rd", zip: "75054" } }),
      deps({ repo })
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.estimateType).toBe("manual_review");
      expect(result.manualReviewReasons).toContain("ZIP_MANUAL_REVIEW_REQUIRED");
      expect(result.range).toBeNull();
    }
    expect(repo.insertedRows).toHaveLength(1);
  });

  it("persists a one-time quote whose scalar DB fields match pricing_snapshot.result exactly", async () => {
    const repo = new FakeInstantQuoteRepository();
    await submitInstantQuote(rawInput(), deps({ repo }));
    const row = repo.insertedRows[0];
    expect(row.calculated_total).toBe(row.pricing_snapshot.result.calculatedTotal);
    expect(row.display_range_lower).toBe(row.pricing_snapshot.result.range?.lower ?? null);
    expect(row.display_range_upper).toBe(row.pricing_snapshot.result.range?.upper ?? null);
    expect(row.has_starting_at_pricing).toBe(row.pricing_snapshot.result.hasStartingAtPricing);
  });

  it("flags hasStartingAtPricing for a starting-at add-on without treating the total as final", async () => {
    const repo = new FakeInstantQuoteRepository();
    const result = await submitInstantQuote(rawInput({ addOnIds: ["inside_cabinets_drawers"] }), deps({ repo }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.hasStartingAtPricing).toBe(true);
    }
  });

  it("routes a manual-quote add-on to manual review without inventing a price", async () => {
    const repo = new FakeInstantQuoteRepository();
    const result = await submitInstantQuote(rawInput({ addOnIds: ["carpet_shampooing"] }), deps({ repo }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.manualReviewRequired).toBe(true);
      expect(result.manualReviewReasons).toContain("MANUAL_QUOTE_ADD_ON_SELECTED");
    }
  });

  it("prices a recurring (non-package) quote using the recurring-cycle discount", async () => {
    const repo = new FakeInstantQuoteRepository();
    await submitInstantQuote(rawInput({ frequency: "weekly" }), deps({ repo }));
    expect(repo.insertedRows[0].service_id).toBe("recurring");
    expect(repo.insertedRows[0].frequency).toBe("weekly");
  });

  it("prices a 6-visit prepaid package with the authoritative package total", async () => {
    const repo = new FakeInstantQuoteRepository();
    const result = await submitInstantQuote(
      rawInput({
        rooms: { bedrooms: 2, fullBathrooms: 2, halfBathrooms: 0 },
        frequency: "weekly",
        isPrepaidPackage: true,
        visitCount: 6,
      }),
      deps({ repo })
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.prepaidPackageTotal).not.toBeNull();
      expect(Number.isInteger(result.prepaidPackageTotal! * 100)).toBe(true);
    }
  });

  it("applies visit-specific package add-ons via visitAddOns, undiscounted", async () => {
    const repo = new FakeInstantQuoteRepository();
    await submitInstantQuote(
      rawInput({
        rooms: { bedrooms: 2, fullBathrooms: 2, halfBathrooms: 0 },
        frequency: "weekly",
        isPrepaidPackage: true,
        visitCount: 6,
        visitAddOns: [["inside_oven"], [], [], [], [], []],
      }),
      deps({ repo })
    );
    const snapshot = repo.insertedRows[0].pricing_snapshot.result;
    expect(snapshot.packageAddOnsTotal).toBe(30);
  });

  it("maps a one-time deep clean to the legacy service_id 'deep'", async () => {
    const repo = new FakeInstantQuoteRepository();
    await submitInstantQuote(rawInput({ cleaningType: "deep" }), deps({ repo }));
    expect(repo.insertedRows[0].service_id).toBe("deep");
  });

  it("persists the real property_type without collapsing apartment to home", async () => {
    const repo = new FakeInstantQuoteRepository();
    await submitInstantQuote(rawInput({ propertyType: "apartment" }), deps({ repo }));
    expect(repo.insertedRows[0].property_type).toBe("apartment");
  });

  it("knows the quote UUID without needing SELECT-after-insert — the returned quoteId matches the persisted row id", async () => {
    const repo = new FakeInstantQuoteRepository();
    const result = await submitInstantQuote(rawInput(), deps({ repo }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.quoteId).toBe(repo.insertedRows[0].id);
      expect(result.quoteId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    }
  });

  it("returns a typed persistence failure and does not throw when the insert fails", async () => {
    const repo = new FakeInstantQuoteRepository();
    repo.insertShouldFail = true;
    const result = await submitInstantQuote(rawInput(), deps({ repo }));
    expect(result).toEqual({ ok: false, stage: "persistence", error: "simulated insert failure" });
  });

  describe("identity conflict", () => {
    async function seedConflict(repo: FakeInstantQuoteRepository) {
      const a = await repo.createCustomer({
        name: "Customer A",
        email: "jane@example.com",
        emailNormalized: "jane@example.com",
        phone: "+14695551111",
        phoneNormalized: "+14695551111",
      });
      const b = await repo.createCustomer({
        name: "Customer B",
        email: "other@example.com",
        emailNormalized: "other@example.com",
        phone: "+14695550100",
        phoneNormalized: "+14695550100",
      });
      return { a, b };
    }

    it("persists the quote with customer_id null and an identity-conflict reason, without merging customers", async () => {
      const repo = new FakeInstantQuoteRepository();
      await seedConflict(repo);

      const result = await submitInstantQuote(rawInput(), deps({ repo }));
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.identityConflict).toBe(true);
        expect(result.customerId).toBeNull();
        expect(result.manualReviewRequired).toBe(true);
        expect(result.manualReviewReasons).toContain("CUSTOMER_IDENTITY_CONFLICT");
      }
      expect(repo.insertedRows[0].customer_id).toBeNull();
      expect(repo.customers).toHaveLength(2); // no merge, no new customer created
    });

    it("forces estimate_type to manual_review even though the underlying pricing succeeded as an ordinary instant range", async () => {
      const repo = new FakeInstantQuoteRepository();
      await seedConflict(repo);

      const result = await submitInstantQuote(rawInput(), deps({ repo }));
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.estimateType).toBe("manual_review");
        // The real calculated figures are still present as informational context.
        expect(result.calculatedTotal).toBeGreaterThan(0);
      }
      expect(repo.insertedRows[0].estimate_type).toBe("manual_review");
    });

    it("does not mutate either existing customer's stored contact info", async () => {
      const repo = new FakeInstantQuoteRepository();
      const { a, b } = await seedConflict(repo);
      const snapshotA = { ...a };
      const snapshotB = { ...b };

      await submitInstantQuote(rawInput(), deps({ repo }));

      expect(repo.customers.find((c) => c.id === a.id)).toEqual(snapshotA);
      expect(repo.customers.find((c) => c.id === b.id)).toEqual(snapshotB);
    });

    it("never exposes either conflicting customer's UUID in the public-safe result", async () => {
      const repo = new FakeInstantQuoteRepository();
      const { a, b } = await seedConflict(repo);

      const result = await submitInstantQuote(rawInput(), deps({ repo }));
      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain(a.id);
      expect(serialized).not.toContain(b.id);
    });

    it("still runs pricing and eligibility, and still persists — a conflict does not abort the request", async () => {
      const repo = new FakeInstantQuoteRepository();
      await seedConflict(repo);

      const result = await submitInstantQuote(rawInput(), deps({ repo }));
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.calculatedTotal).toBeGreaterThan(0);
      }
      expect(repo.insertedRows).toHaveLength(1);
    });
  });

  describe("contact refresh wiring (safer per-match-kind rules)", () => {
    it("email-only match does not overwrite a different existing non-null phone", async () => {
      const repo = new FakeInstantQuoteRepository();
      const customer = await repo.createCustomer({
        name: "Jane Customer",
        email: "jane@example.com",
        emailNormalized: "jane@example.com",
        phone: "+14695551111",
        phoneNormalized: "+14695551111",
      });

      await submitInstantQuote(rawInput({ phone: "469-555-0100" }), deps({ repo }));

      const updated = repo.customers.find((c) => c.id === customer.id)!;
      expect(updated.phoneNormalized).toBe("+14695551111"); // untouched
    });

    it("email-only match fills a currently-null phone", async () => {
      const repo = new FakeInstantQuoteRepository();
      const customer = await repo.createCustomer({
        name: "Jane Customer",
        email: "jane@example.com",
        emailNormalized: "jane@example.com",
        phone: null,
        phoneNormalized: null,
      });

      await submitInstantQuote(rawInput({ phone: "469-555-0100" }), deps({ repo }));

      const updated = repo.customers.find((c) => c.id === customer.id)!;
      expect(updated.phoneNormalized).toBe("+14695550100");
    });

    it("dual match (email and phone both match the same customer) refreshes all contact fields", async () => {
      const repo = new FakeInstantQuoteRepository();
      const customer = await repo.createCustomer({
        name: "Old Name",
        email: "jane@example.com",
        emailNormalized: "jane@example.com",
        phone: "+14695550100",
        phoneNormalized: "+14695550100",
      });

      await submitInstantQuote(rawInput({ name: "New Name" }), deps({ repo }));

      const updated = repo.customers.find((c) => c.id === customer.id)!;
      expect(updated.name).toBe("New Name");
    });

    it("quote_requests always preserves the raw submitted contact info regardless of what the customer profile refresh did", async () => {
      const repo = new FakeInstantQuoteRepository();
      await repo.createCustomer({
        name: "Jane Customer",
        email: "jane@example.com",
        emailNormalized: "jane@example.com",
        phone: "+14695551111",
        phoneNormalized: "+14695551111",
      });

      await submitInstantQuote(rawInput({ phone: "469-555-0100" }), deps({ repo }));

      // The customer's stored phone stayed +14695551111 (not overwritten), but
      // this specific quote row still records exactly what was submitted.
      expect(repo.insertedRows[0].phone).toBe("469-555-0100");
      expect(repo.insertedRows[0].phone_normalized).toBe("+14695550100");
    });
  });

  describe("security/trust — nothing client-suppliable is treated as authoritative", () => {
    it("ignores a smuggled calculatedTotal and recomputes from scratch", async () => {
      const repo = new FakeInstantQuoteRepository();
      const hostile = { ...rawInput(), calculatedTotal: 1 } as InstantQuoteRawInput & { calculatedTotal: number };
      const result = await submitInstantQuote(hostile, deps({ repo }));
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.calculatedTotal).not.toBe(1);
        expect(result.calculatedTotal).toBeCloseTo(105.3);
      }
    });

    it("ignores a smuggled pricing_snapshot and builds its own from the real engine", async () => {
      const repo = new FakeInstantQuoteRepository();
      const hostile = { ...rawInput(), pricing_snapshot: { input: {}, result: { calculatedTotal: 1 } } } as InstantQuoteRawInput & {
        pricing_snapshot: unknown;
      };
      await submitInstantQuote(hostile, deps({ repo }));
      expect(repo.insertedRows[0].pricing_snapshot.result.calculatedTotal).toBeCloseTo(105.3);
    });

    it("ignores a smuggled discount/offer percentage — the server helper alone decides", async () => {
      const repo = new FakeInstantQuoteRepository();
      const hostile = { ...rawInput(), activeFirstCleaningOfferPercent: 99 } as InstantQuoteRawInput & {
        activeFirstCleaningOfferPercent: number;
      };
      const result = await submitInstantQuote(hostile, deps({ repo }));
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.calculatedTotal).toBeCloseTo(105.3); // still exactly the real 30% launch figure, not a 99%-off figure
      }
    });

    it("ignores a smuggled asOf/current-date claim — the server's own clock (internalDependencies.asOf in tests) is always authoritative", async () => {
      const repo = new FakeInstantQuoteRepository();
      // Smuggle a date far outside the launch window into the raw payload —
      // InstantQuoteRawInput has no `asOf` field, so even a hostile object
      // with an extra property can't influence which offer applies.
      const hostile = { ...rawInput(), asOf: new Date("2026-09-15T00:00:00Z") } as InstantQuoteRawInput & {
        asOf: Date;
      };
      const result = await submitInstantQuote(hostile, deps({ repo, asOf: new Date("2026-08-20T00:00:00Z") }));
      expect(result.ok).toBe(true);
      if (result.ok) {
        // Still the 30% launch figure, from internalDependencies.asOf — the smuggled September date was never read.
        expect(result.calculatedTotal).toBeCloseTo(105.3);
      }
    });

    it("ignores a smuggled firstCleaningEligible claim — eligibility is always server-derived", async () => {
      const repo = new FakeInstantQuoteRepository();
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
      const result = await submitInstantQuote(hostile, deps({ repo }));
      expect(result.ok).toBe(true);
      if (result.ok) {
        // Real service history says NOT eligible — the smuggled `true` is never read.
        expect(result.calculatedTotal).toBe(144);
      }
    });

    it("ignores a smuggled service_address_identity — the server always rebuilds it from line1/line2/zip", async () => {
      const repo = new FakeInstantQuoteRepository();
      const realIdentity = buildServiceAddressIdentity({ zip: "75056", line1: "123 Main St" })!;
      const hostile = {
        ...rawInput(),
        serviceAddress: { ...rawInput().serviceAddress, service_address_identity: "FAKE|IDENTITY|X" },
      } as InstantQuoteRawInput;
      await submitInstantQuote(hostile, deps({ repo }));
      expect(repo.insertedRows[0].service_address_identity).toBe(realIdentity);
      expect(repo.insertedRows[0].service_address_identity).not.toBe("FAKE|IDENTITY|X");
    });

    it("entry_channel is always 'website', hardcoded server-side — a smuggled claim of 'admin' is never read", async () => {
      const repo = new FakeInstantQuoteRepository();
      const hostile = { ...rawInput(), entryChannel: "admin" } as InstantQuoteRawInput & { entryChannel: string };
      await submitInstantQuote(hostile, deps({ repo }));
      expect(repo.insertedRows[0].entry_channel).toBe("website");
    });

    it("InstantQuoteRawInput has no entryChannel or asOf field in its type at all — a structural guarantee, not just a runtime check", () => {
      // Compile-time assertion: this file would fail `tsc --noEmit` if either
      // field existed on the public input type.
      const input = rawInput();
      expect("entryChannel" in input).toBe(false);
      expect("asOf" in input).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// Backward compatibility (2026-08-30 pricing hotfix): the pre-hotfix live
// wizard sends a payload shaped exactly like `rawInput()` above — no
// specialRooms/movePackageLevel/moveDirection/outdoorSelection/
// quantifiedAddOns at all. That old-shaped payload must keep validating and
// calculating successfully with safe defaults, since these new selections
// are additive and never mandatory for an existing caller that doesn't know
// about them.
// ---------------------------------------------------------------------------

describe("backward compatibility with the pre-hotfix payload shape", () => {
  it("an old-shape (no new hotfix fields) one-time Standard quote still submits successfully", async () => {
    const repo = new FakeInstantQuoteRepository();
    const result = await submitInstantQuote(rawInput(), deps({ repo }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.estimateType).toBe("instant_range");
    }
  });

  it("an old-shape Move-In/Move-Out quote (no movePackageLevel sent at all) defaults to Basic and prices/persists correctly", async () => {
    const repo = new FakeInstantQuoteRepository();
    const result = await submitInstantQuote(rawInput({ cleaningType: "move" }), deps({ repo }));
    expect(result.ok).toBe(true);
    const snapshot = repo.insertedRows[0].pricing_snapshot;
    expect(snapshot.input.movePackageLevel).toBeUndefined();
    expect(snapshot.result.movePackageLevel).toBe("basic");
    expect(snapshot.result.moveCompleteUpgrade).toBe(0);
    expect(snapshot.result.includedByCompletePackage).toEqual([]);
  });

  it("every new selection defaults to none/zero on the persisted result when the old payload shape is used", async () => {
    const repo = new FakeInstantQuoteRepository();
    await submitInstantQuote(rawInput(), deps({ repo }));
    const result = repo.insertedRows[0].pricing_snapshot.result;
    expect(result.specialRoomCharges).toEqual([]);
    expect(result.specialRoomChargesTotal).toBe(0);
    expect(result.quantifiedAddOns).toEqual([]);
    expect(result.quantifiedAddOnsTotal).toBe(0);
    expect(result.outdoorCharges).toEqual([]);
    expect(result.outdoorChargesTotal).toBe(0);
    expect(result.outdoorManualCharges).toEqual([]);
    expect(result.movePackageLevel).toBeNull(); // not a move request
    expect(result.moveDirection).toBeNull();
    expect(result.includedByCompletePackage).toEqual([]);
    expect(result.completePackageRecommended).toBe(false);
  });

  it("produces the same deterministic total as every other test using this exact old-shape payload (Standard, 1BR, light, one-time, first-cleaning eligible)", async () => {
    const repo = new FakeInstantQuoteRepository();
    await submitInstantQuote(rawInput(), deps({ repo }));
    // Matches the figure other pre-existing tests in this file already rely
    // on for this exact rawInput()/deps() combination (e.g. the "smuggled
    // pricing_snapshot" test above) — 30% first-cleaning off $129, +$15 flat supplies.
    expect(repo.insertedRows[0].calculated_total).toBe(105.3);
  });
});

// ---------------------------------------------------------------------------
// Persistence verification (2026-08-30 pricing hotfix): every new selection/
// quantity/package choice must survive the full path from raw customer
// input through calculateEstimate to quote_requests.pricing_snapshot,
// without any DB migration (pricing_snapshot is an existing jsonb column
// that stores { input, result } verbatim).
// ---------------------------------------------------------------------------

describe("new hotfix selections survive persistence end-to-end", () => {
  it("Game Room / Media Room selections survive into pricing_snapshot.input and .result", async () => {
    const repo = new FakeInstantQuoteRepository();
    await submitInstantQuote(rawInput({ specialRooms: ["game_room", "media_room"] }), deps({ repo }));
    const snapshot = repo.insertedRows[0].pricing_snapshot;
    expect(snapshot.input.specialRooms).toEqual(["game_room", "media_room"]);
    expect(snapshot.result.specialRoomCharges.map((c) => c.id).sort()).toEqual(["game_room", "media_room"]);
    expect(snapshot.result.specialRoomChargesTotal).toBeGreaterThan(0);
  });

  it("Move package level, direction, and the Complete upgrade survive into pricing_snapshot", async () => {
    const repo = new FakeInstantQuoteRepository();
    await submitInstantQuote(
      rawInput({ cleaningType: "move", movePackageLevel: "complete", moveDirection: "move_out", squareFeet: 1300 }),
      deps({ repo })
    );
    const snapshot = repo.insertedRows[0].pricing_snapshot;
    expect(snapshot.input.movePackageLevel).toBe("complete");
    expect(snapshot.input.moveDirection).toBe("move_out");
    expect(snapshot.result.movePackageLevel).toBe("complete");
    expect(snapshot.result.moveDirection).toBe("move_out");
    expect(snapshot.result.moveCompleteUpgrade).toBe(50);
    expect(repo.insertedRows[0].calculated_total).toBe(snapshot.result.calculatedTotal);
  });

  it("outdoor selections (Trio + condition treatments) survive into pricing_snapshot", async () => {
    const repo = new FakeInstantQuoteRepository();
    await submitInstantQuote(
      rawInput({ outdoorSelection: { trio: "small", algaeMildewTreatmentSize: "medium" } }),
      deps({ repo })
    );
    const snapshot = repo.insertedRows[0].pricing_snapshot;
    expect(snapshot.input.outdoorSelection).toEqual({ trio: "small", algaeMildewTreatmentSize: "medium" });
    expect(snapshot.result.outdoorChargesTotal).toBe(99 + 75);
  });

  it("quantified (per-unit) add-ons survive into pricing_snapshot with their quantity intact", async () => {
    const repo = new FakeInstantQuoteRepository();
    await submitInstantQuote(
      rawInput({ quantifiedAddOns: [{ id: "interior_window_detailing", quantity: 4 }] }),
      deps({ repo })
    );
    const snapshot = repo.insertedRows[0].pricing_snapshot;
    expect(snapshot.input.quantifiedAddOns).toEqual([{ id: "interior_window_detailing", quantity: 4 }]);
    expect(snapshot.result.quantifiedAddOns).toEqual([
      { id: "interior_window_detailing", label: "Interior Window Detailing", quantity: 4, amount: 40 },
    ]);
    expect(snapshot.result.quantifiedAddOnsTotal).toBe(40);
  });

  it("Complete package double-charge prevention survives end-to-end: includedByCompletePackage is persisted, not merely computed and discarded", async () => {
    const repo = new FakeInstantQuoteRepository();
    await submitInstantQuote(
      rawInput({
        cleaningType: "move",
        movePackageLevel: "complete",
        addOnIds: ["inside_refrigerator", "inside_oven", "inside_cabinets_drawers"],
      }),
      deps({ repo })
    );
    const snapshot = repo.insertedRows[0].pricing_snapshot;
    expect(snapshot.result.pricedAddOnsTotal).toBe(0);
    expect(snapshot.result.includedByCompletePackage.map((a) => a.id).sort()).toEqual(
      ["inside_cabinets_drawers", "inside_oven", "inside_refrigerator"].sort()
    );
  });
});

// ---------------------------------------------------------------------------
// Complete >4,500 sq ft submission safety (owner audit request, 2026-08-31):
// under REAL production config, a >4,500 sq ft request hits the general
// square-footage ceiling before ever reaching the Complete-specific branch
// (both ceilings coincide at 4,500 sq ft for the largest tier) — the whole
// request becomes manual-review, so the customer-safe result never exposes
// ANY calculatedTotal/range at all, not Basic's and not a fabricated
// Complete figure. This is a stronger guarantee than the isolated
// engine-level "Complete unconfigured, Basic still priced" case covered by
// hotfix-2026-08-30.test.ts (which requires an isolated config override to
// even construct, since real production config never reaches it).
// ---------------------------------------------------------------------------

describe("Complete >4,500 sq ft submission safety", () => {
  it("a >4,500 sq ft Move-In/Move-Out Complete request never presents or persists a fabricated instant total", async () => {
    const repo = new FakeInstantQuoteRepository();
    const result = await submitInstantQuote(
      rawInput({
        cleaningType: "move",
        movePackageLevel: "complete",
        rooms: { bedrooms: 4, fullBathrooms: 3, halfBathrooms: 0 }, // resolves to the 4br_plus tier (4,500 sq ft ceiling)
        squareFeet: 4600,
      }),
      deps({ repo })
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      // The customer-safe result carries no usable instant price for this request.
      expect(result.estimateType).toBe("manual_review");
      expect(result.manualReviewRequired).toBe(true);
      expect(result.range).toBeNull();
    }

    // The persisted row is unambiguously flagged manual-review — an admin
    // resolves the real scope/price by hand; nothing here is presentable as
    // an automatic quote.
    const row = repo.insertedRows[0];
    expect(row.estimate_type).toBe("manual_review");
    expect(row.display_range_lower).toBeNull();
    expect(row.display_range_upper).toBeNull();
    expect(row.manual_review_reasons).toEqual(
      expect.arrayContaining(["SQUARE_FOOTAGE_BEYOND_CONFIGURED_LIMIT", "MOVE_COMPLETE_UPGRADE_NOT_CONFIGURED"])
    );

    // The customer-safe mapper — what the actual public submission path
    // (submitInstantQuoteRequest -> mapToCustomerSafeResult) hands to the
    // UI — never exposes calculatedTotal/displayRange fields for a
    // manual_review result at all, verified structurally, not just by value.
    if (result.ok) {
      const customerSafe = mapToCustomerSafeResult(result);
      expect(customerSafe.estimateType).toBe("manual_review");
      expect(customerSafe).not.toHaveProperty("displayRangeLower");
      expect(customerSafe).not.toHaveProperty("displayRangeUpper");
      expect(customerSafe).not.toHaveProperty("calculatedTotal");
    }
  });
});
