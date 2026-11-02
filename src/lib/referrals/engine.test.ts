import { describe, expect, it } from "vitest";
import { allocateCustomerReferralCode, generateReferralCode, normalizeReferralCode, ReferralCodeCollision } from "./codes";
import { REFERRAL_CODE_ALPHABET, REFERRAL_CREDIT_DOLLARS } from "./constants";
import { createReferralProgram, type AttributeInput, type QualificationInput, type ReserveInput } from "./engine";
import { creditVisibleToCustomer, referralVisibleToCustomer } from "./authorize";
import { assertCanManageReferralProgram } from "./authorize";
import { AdminForbiddenError } from "@/lib/admin/rbac/capabilities";

const DAY = 24 * 60 * 60 * 1000;

function attributeInput(overrides: Partial<AttributeInput> = {}): AttributeInput {
  return {
    code: "ABCD2345",
    friendCustomerId: "friend-1",
    friendEmail: "friend@example.com",
    friendPhone: "+14695550111",
    householdKey: "75056|10 OAK ST|",
    friendHasCompletedService: false,
    friendPaymentMethodId: "pm_friend",
    referrerEmail: "referrer@example.com",
    referrerPhone: "+14695550222",
    referrerAddresses: [],
    referrerPaymentMethodId: "pm_referrer",
    quoteRequestId: "quote-1",
    agreedQuoteInvitationId: null,
    bookingOrderId: "booking-1",
    ...overrides,
  };
}

function qualification(overrides: Partial<QualificationInput> = {}): QualificationInput {
  return {
    visitId: "visit-1",
    customerId: "friend-1",
    completed: true,
    fullyPaid: true,
    priorCompletedVisitCount: 0,
    now: new Date("2026-11-01T12:00:00.000Z"),
    ...overrides,
  };
}

function reserveInput(overrides: Partial<ReserveInput> = {}): ReserveInput {
  return {
    customerId: "friend-1",
    visitId: "visit-2",
    priorCompletedVisitCount: 1,
    prepaidPackageId: null,
    baseAmount: 150,
    customDiscountAmount: 0,
    discountProgram: "none",
    now: new Date("2026-11-15T12:00:00.000Z"),
    ...overrides,
  };
}

async function referrerWithFriend(program = createReferralProgram()) {
  const code = await program.issueCustomerCode("referrer-1");
  const attributed = await program.attribute(attributeInput({ code: code.code }));
  if (!attributed.ok) throw new Error(attributed.reason);
  return { program, code, referralId: attributed.referralId };
}

describe("referral codes", () => {
  it("uses a random non-sequential alphabet and never embeds contact details", () => {
    const samples = new Set<string>();
    for (let i = 0; i < 20; i += 1) samples.add(generateReferralCode());
    expect(samples.size).toBeGreaterThan(1);
    for (const code of samples) {
      expect(code).toHaveLength(8);
      expect(normalizeReferralCode(code)).toBe(code);
      for (const char of code) expect(REFERRAL_CODE_ALPHABET.includes(char)).toBe(true);
      expect(code).not.toMatch(/friend@|1469555|oak/i);
    }
    expect(normalizeReferralCode("ab cd-2345")).toBeNull();
    expect(normalizeReferralCode("friend@example.com")).toBeNull();
  });

  it("retries a code collision and keeps a single reusable code per customer", async () => {
    const inserted: string[] = ["TAKEN234"];
    const allocated = await allocateCustomerReferralCode({
      findExisting: async () => null,
      generate: (() => {
        const values = ["TAKEN234", "FRESH234"];
        return () => values.shift() ?? "FRESH234";
      })(),
      tryInsert: async (code) => {
        if (inserted.includes(code)) throw new ReferralCodeCollision();
        inserted.push(code);
        return { code };
      },
    });
    expect(allocated.code).toBe("FRESH234");

    const program = createReferralProgram();
    const first = await program.issueCustomerCode("referrer-1");
    const second = await program.issueCustomerCode("referrer-1");
    expect(second.code).toBe(first.code);
    expect(program.codes.filter((row) => row.referrerCustomerId === "referrer-1")).toHaveLength(1);
  });

  it("lets an owner issue a type B code with no customer account", async () => {
    const program = createReferralProgram();
    const code = await program.issueAdminCode("owner-1");
    expect(code.codeType).toBe("admin_issued");
    expect(code.referrerCustomerId).toBeNull();
    expect(program.audits.map((row) => row.actionType)).toEqual(["code_issued"]);
    await program.setCodeActive(code.id, false, "owner-1", "retired");
    expect(program.codes[0]?.active).toBe(false);
    expect(program.audits.map((row) => row.actionType)).toEqual(["code_issued", "code_disabled"]);
  });
});

describe("referral attribution", () => {
  it("rejects an inactive code, a self-referral, and a customer who is not new", async () => {
    const program = createReferralProgram();
    const code = await program.issueCustomerCode("referrer-1");
    await program.setCodeActive(code.id, false, "owner-1", null);
    expect((await program.attribute(attributeInput({ code: code.code }))).ok).toBe(false);

    await program.setCodeActive(code.id, true, "owner-1", null);
    const self = await program.attribute(
      attributeInput({ code: code.code, friendCustomerId: "referrer-1", friendEmail: "referrer@example.com" })
    );
    expect(self).toEqual({ ok: false, reason: "SELF_REFERRAL" });

    const sameEmail = await program.attribute(attributeInput({ code: code.code, friendEmail: "referrer@example.com" }));
    expect(sameEmail).toEqual({ ok: false, reason: "SELF_REFERRAL" });

    const returning = await program.attribute(attributeInput({ code: code.code, friendHasCompletedService: true }));
    expect(returning).toEqual({ ok: false, reason: "NOT_NEW_CUSTOMER" });

    expect(await program.attribute(attributeInput({ code: "ZZZZZZZZ" }))).toEqual({ ok: false, reason: "UNKNOWN_CODE" });
  });

  it("flags a shared address or payment method and still records attribution", async () => {
    const program = createReferralProgram();
    const code = await program.issueCustomerCode("referrer-1");
    const result = await program.attribute(
      attributeInput({
        code: code.code,
        referrerAddresses: ["75056|10 OAK ST|"],
        referrerPaymentMethodId: "pm_friend",
      })
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.flags).toEqual(["shared_address", "shared_payment"]);
    expect(program.referrals[0]?.status).toBe("review");
    expect(program.referrals[0]?.quoteRequestId).toBe("quote-1");
    expect(program.referrals[0]?.bookingOrderId).toBe("booking-1");
  });
});

describe("referral credit issuance", () => {
  it("issues $15 to the friend and the referrer for a personal code, once, in either event order", async () => {
    const { program } = await referrerWithFriend();
    const paidFirst = await program.syncQualification(qualification({ completed: false, fullyPaid: true }));
    expect(paidFirst.issuedCreditIds).toEqual([]);
    const both = await program.syncQualification(qualification());
    expect(both.issuedCreditIds).toHaveLength(2);
    const again = await program.syncQualification(qualification());
    expect(again.issuedCreditIds).toEqual(both.issuedCreditIds);
    expect(program.credits.map((credit) => credit.amount)).toEqual([REFERRAL_CREDIT_DOLLARS, REFERRAL_CREDIT_DOLLARS]);
    expect(program.credits.map((credit) => credit.beneficiaryRole).sort()).toEqual(["friend", "referrer"]);

    const { program: completedFirst } = await referrerWithFriend();
    expect((await completedFirst.syncQualification(qualification({ completed: true, fullyPaid: false }))).issuedCreditIds).toEqual([]);
    expect((await completedFirst.syncQualification(qualification())).issuedCreditIds).toHaveLength(2);
  });

  it("issues only the friend's credit for an owner-issued code", async () => {
    const program = createReferralProgram();
    const code = await program.issueAdminCode("owner-1");
    const attributed = await program.attribute(attributeInput({ code: code.code }));
    expect(attributed.ok).toBe(true);
    const issued = await program.syncQualification(qualification());
    expect(issued.issuedCreditIds).toHaveLength(1);
    expect(program.credits[0]?.beneficiaryRole).toBe("friend");
    expect(program.credits[0]?.expiresAt.getTime() - program.credits[0]?.issuedAt.getTime()).toBe(60 * DAY);
  });

  it("caps the referrer at 5 credits per rolling 12 months while every friend still qualifies", async () => {
    const program = createReferralProgram();
    const code = await program.issueCustomerCode("referrer-1");
    const now = new Date("2026-11-01T12:00:00.000Z");
    for (let i = 0; i < 6; i += 1) {
      const friendId = `friend-${i}`;
      const attributed = await program.attribute(
        attributeInput({
          code: code.code,
          friendCustomerId: friendId,
          friendEmail: `friend-${i}@example.com`,
          friendPhone: `+14695550${100 + i}`,
          householdKey: `75056|${i} OAK ST|`,
        })
      );
      expect(attributed.ok).toBe(true);
      await program.syncQualification(
        qualification({ visitId: `visit-${i}`, customerId: friendId, now })
      );
    }
    const referrerCredits = program.credits.filter((credit) => credit.beneficiaryRole === "referrer");
    const friendCredits = program.credits.filter((credit) => credit.beneficiaryRole === "friend");
    expect(referrerCredits).toHaveLength(5);
    expect(friendCredits).toHaveLength(6);
  });

  it("serializes concurrent qualification so the cap and the one-time issue both hold", async () => {
    const program = createReferralProgram();
    const code = await program.issueCustomerCode("referrer-1");
    const now = new Date("2026-11-01T12:00:00.000Z");
    await Promise.all(
      Array.from({ length: 8 }, async (_, i) => {
        const friendId = `friend-${i}`;
        await program.attribute(
          attributeInput({
            code: code.code,
            friendCustomerId: friendId,
            friendEmail: `friend-${i}@example.com`,
            friendPhone: `+14695551${100 + i}`,
            householdKey: `75034|${i} ELM ST|`,
          })
        );
        await Promise.all([
          program.syncQualification(qualification({ visitId: `visit-${i}`, customerId: friendId, now })),
          program.syncQualification(qualification({ visitId: `visit-${i}`, customerId: friendId, now })),
        ]);
      })
    );
    expect(program.credits.filter((credit) => credit.beneficiaryRole === "referrer")).toHaveLength(5);
    expect(program.credits.filter((credit) => credit.beneficiaryRole === "friend")).toHaveLength(8);
    const perReferral = new Map<string, number>();
    for (const credit of program.credits) perReferral.set(credit.referralId, (perReferral.get(credit.referralId) ?? 0) + 1);
    for (const count of perReferral.values()) expect(count).toBeLessThanOrEqual(2);
  });

  it("issues one referrer credit when two qualifications race and four rewards are already used", async () => {
    const program = createReferralProgram();
    const code = await program.issueCustomerCode("referrer-1");
    const now = new Date("2026-11-01T12:00:00.000Z");
    for (let i = 0; i < 4; i += 1) {
      const friendId = `friend-${i}`;
      const attributed = await program.attribute(
        attributeInput({
          code: code.code,
          friendCustomerId: friendId,
          friendEmail: `friend-${i}@example.com`,
          friendPhone: `+14695552${100 + i}`,
          householdKey: `75056|${i} PINE ST|`,
        })
      );
      expect(attributed.ok).toBe(true);
      await program.syncQualification(qualification({ visitId: `visit-${i}`, customerId: friendId, now }));
    }
    expect(program.credits.filter((credit) => credit.beneficiaryRole === "referrer")).toHaveLength(4);

    await Promise.all(
      [4, 5].map(async (i) => {
        const friendId = `friend-${i}`;
        await program.attribute(
          attributeInput({
            code: code.code,
            friendCustomerId: friendId,
            friendEmail: `friend-${i}@example.com`,
            friendPhone: `+14695553${100 + i}`,
            householdKey: `75034|${i} PINE ST|`,
          })
        );
        await program.syncQualification(qualification({ visitId: `visit-${i}`, customerId: friendId, now }));
      })
    );

    const newReferralIds = new Set(
      program.referrals.filter((row) => row.referredCustomerId === "friend-4" || row.referredCustomerId === "friend-5").map((row) => row.id)
    );
    const referrerCredits = program.credits.filter((credit) => credit.beneficiaryRole === "referrer");
    const newFriendCredits = program.credits.filter(
      (credit) => credit.beneficiaryRole === "friend" && newReferralIds.has(credit.referralId)
    );
    expect(referrerCredits).toHaveLength(5);
    expect(newFriendCredits).toHaveLength(2);
    expect(referrerCredits.filter((credit) => newReferralIds.has(credit.referralId))).toHaveLength(1);
  });
});

describe("referral redemption", () => {
  async function issuedFriendCredit() {
    const { program } = await referrerWithFriend();
    await program.syncQualification(qualification());
    return program;
  }

  it("redeems on a $150 cleaning and refuses $149.99", async () => {
    const program = await issuedFriendCredit();
    expect((await program.reserve(reserveInput({ baseAmount: 149.99 }))).amount).toBe(0);
    expect((await program.reserve(reserveInput({ baseAmount: 150 }))).amount).toBe(15);
    expect((await program.reserve(reserveInput({ visitId: "visit-3", baseAmount: 180 }))).amount).toBe(0);
  });

  it("keeps the friend credit off the first cleaning and allows it on the second", async () => {
    const program = await issuedFriendCredit();
    expect((await program.reserve(reserveInput({ visitId: "visit-1", priorCompletedVisitCount: 0 }))).amount).toBe(0);
    expect((await program.reserve(reserveInput())).amount).toBe(15);
  });

  it("does not stack with another discount, a first-cleaning offer, or a prepaid package", async () => {
    const program = await issuedFriendCredit();
    expect((await program.reserve(reserveInput({ customDiscountAmount: 10 }))).amount).toBe(0);
    expect((await program.reserve(reserveInput({ discountProgram: "first_cleaning" }))).amount).toBe(0);
    expect((await program.reserve(reserveInput({ prepaidPackageId: "pkg-1", discountProgram: "prepaid_package" }))).amount).toBe(0);
    expect((await program.reserve(reserveInput({ discountProgram: "recurring_cycle", baseAmount: 150 }))).amount).toBe(15);
  });

  it("lets the referrer redeem on a later cleaning of their own", async () => {
    const program = await issuedFriendCredit();
    const referrer = await program.reserve(
      reserveInput({ customerId: "referrer-1", visitId: "referrer-visit", priorCompletedVisitCount: 3, baseAmount: 209 })
    );
    expect(referrer.amount).toBe(15);
  });

  it("expires 60 days after issuance and does not extend that date when a visit is cancelled", async () => {
    const program = await issuedFriendCredit();
    const issuedAt = program.credits[0]?.issuedAt as Date;
    const expiresAt = program.credits[0]?.expiresAt as Date;
    expect((await program.reserve(reserveInput({ now: expiresAt }))).amount).toBe(0);

    const fresh = await issuedFriendCredit();
    await fresh.reserve(reserveInput());
    await fresh.consume("visit-2");
    await fresh.restoreOnCancel("visit-2", new Date(issuedAt.getTime() + 10 * DAY));
    const restored = fresh.credits.find((credit) => credit.beneficiaryRole === "friend");
    expect(restored?.status).toBe("available");
    expect(restored?.expiresAt).toEqual(expiresAt);
    await fresh.reserve(reserveInput({ visitId: "visit-4" }));
    await fresh.restoreOnCancel("visit-4", new Date(expiresAt.getTime() + DAY));
    expect(fresh.credits.find((credit) => credit.beneficiaryRole === "friend")?.status).toBe("expired");
    expect(fresh.credits.find((credit) => credit.beneficiaryRole === "friend")?.expiresAt).toEqual(expiresAt);
  });

  it("consumes a reserved credit once and restores it when that visit is cancelled", async () => {
    const program = await issuedFriendCredit();
    await program.reserve(reserveInput());
    await program.consume("visit-2");
    await program.consume("visit-2");
    expect(program.credits.find((credit) => credit.beneficiaryRole === "friend")?.status).toBe("redeemed");
    expect(program.redemptions.filter((row) => row.status === "consumed")).toHaveLength(1);
    await program.restoreOnCancel("visit-2", new Date("2026-11-20T12:00:00.000Z"));
    expect(program.credits.find((credit) => credit.beneficiaryRole === "friend")?.status).toBe("available");
    expect(program.redemptions[0]?.status).toBe("restored");
  });

  it("voids unused credits and flags used credits when the qualifying visit is fully refunded", async () => {
    const program = await issuedFriendCredit();
    await program.reserve(reserveInput({ customerId: "referrer-1", visitId: "referrer-visit" }));
    await program.consume("referrer-visit");
    await program.reverseQualifyingVisit("visit-1");
    expect(program.credits.find((credit) => credit.beneficiaryRole === "friend")?.status).toBe("voided");
    expect(program.credits.find((credit) => credit.beneficiaryRole === "referrer")?.status).toBe("review");
  });
});

describe("referral access", () => {
  it("shows a customer only their own code and credits", async () => {
    const program = await (async () => {
      const { program: created } = await referrerWithFriend();
      await created.syncQualification(qualification());
      return created;
    })();
    const referrerView = program.customerView("referrer-1", new Date("2026-11-02T12:00:00.000Z"));
    expect(referrerView.code?.referrerCustomerId).toBe("referrer-1");
    expect(referrerView.credits.every((credit) => credit.beneficiaryCustomerId === "referrer-1")).toBe(true);
    const stranger = program.customerView("someone-else", new Date("2026-11-02T12:00:00.000Z"));
    expect(stranger.code).toBeNull();
    expect(stranger.credits).toEqual([]);
    expect(creditVisibleToCustomer("friend-1", "referrer-1")).toBe(false);
    expect(
      referralVisibleToCustomer({ referredCustomerId: "friend-1", referrerCustomerId: "referrer-1", viewerCustomerId: "friend-1" })
    ).toBe(true);
    expect(() => assertCanManageReferralProgram("operations")).toThrow(AdminForbiddenError);
    expect(() => assertCanManageReferralProgram("owner_admin")).not.toThrow();
  });
});
