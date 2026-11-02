import { randomUUID } from "node:crypto";
import { allocateCustomerReferralCode, generateReferralCode, normalizeReferralCode, ReferralCodeCollision } from "./codes";
import {
  REFERRAL_CREDIT_DOLLARS,
  REFERRAL_CREDIT_EXPIRY_DAYS,
  REFERRER_CAP_MONTHS,
  REFERRER_CREDIT_CAP,
} from "./constants";
import { referralRedemptionBlockReason, type ReferralDiscountProgram } from "./eligibility";
import { assessReferralPricing, type ReferralPricingAssessmentInput } from "./pricing-assessment";

export type ReferralCodeType = "customer" | "admin_issued";
export type ReferralStatus = "attributed" | "credited" | "review" | "rejected";
export type CreditStatus = "available" | "reserved" | "redeemed" | "expired" | "voided" | "review";
export type RedemptionStatus = "reserved" | "consumed" | "restored" | "voided";
export type ReviewFlag = "shared_address" | "shared_payment";

export interface ReferralCodeRecord {
  id: string;
  code: string;
  codeType: ReferralCodeType;
  referrerCustomerId: string | null;
  issuedByAdminUserId: string | null;
  active: boolean;
}

export interface ReferralRecord {
  id: string;
  referralCodeId: string;
  code: string;
  codeType: ReferralCodeType;
  referrerCustomerId: string | null;
  referredCustomerId: string;
  householdKey: string | null;
  qualifyingServiceVisitId: string | null;
  quoteRequestId: string | null;
  agreedQuoteInvitationId: string | null;
  bookingOrderId: string | null;
  status: ReferralStatus;
  reviewFlags: ReviewFlag[];
}

export interface CreditRecord {
  id: string;
  beneficiaryCustomerId: string;
  referralId: string;
  beneficiaryRole: "friend" | "referrer";
  amount: number;
  issuedAt: Date;
  expiresAt: Date;
  status: CreditStatus;
}

export interface RedemptionRecord {
  id: string;
  referralCreditId: string;
  serviceVisitId: string;
  amount: number;
  status: RedemptionStatus;
  eligibleCleaningAmount: number;
}

export interface AuditRecord {
  id: string;
  actorAdminUserId: string;
  actionType: string;
  targetId: string;
  reason: string | null;
  createdAt: Date;
}

export type AttributeResult =
  | { ok: true; referralId: string; referralCodeId: string; flags: ReviewFlag[] }
  | { ok: false; reason: "UNKNOWN_CODE" | "INACTIVE_CODE" | "SELF_REFERRAL" | "NOT_NEW_CUSTOMER" };

export interface AttributeInput {
  code: string;
  friendCustomerId: string;
  friendEmail: string | null;
  friendPhone: string | null;
  householdKey: string | null;
  friendHasCompletedService: boolean;
  friendPaymentMethodId: string | null;
  referrerEmail: string | null;
  referrerPhone: string | null;
  referrerAddresses: string[];
  referrerPaymentMethodId: string | null;
  quoteRequestId: string | null;
  agreedQuoteInvitationId: string | null;
  bookingOrderId: string | null;
}

export interface QualificationInput {
  visitId: string;
  customerId: string;
  completed: boolean;
  fullyPaid: boolean;
  priorCompletedVisitCount: number;
  now: Date;
}

export interface ReserveInput extends ReferralPricingAssessmentInput {
  customerId: string;
  visitId: string;
  priorCompletedVisitCount: number;
  prepaidPackageId: string | null;
  baseAmount: number;
  customDiscountAmount: number;
  discountProgram: ReferralDiscountProgram;
  now: Date;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function capWindowStart(now: Date): Date {
  const start = new Date(now.getTime());
  start.setUTCMonth(start.getUTCMonth() - REFERRER_CAP_MONTHS);
  return start;
}

function sameIdentity(left: string | null, right: string | null): boolean {
  return left != null && right != null && left === right;
}

class Mutex {
  private tail: Promise<void> = Promise.resolve();

  run<T>(fn: () => Promise<T> | T): Promise<T> {
    const run = this.tail.then(() => fn());
    this.tail = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }
}

export function createReferralProgram() {
  const codes: ReferralCodeRecord[] = [];
  const referrals: ReferralRecord[] = [];
  const credits: CreditRecord[] = [];
  const redemptions: RedemptionRecord[] = [];
  const audits: AuditRecord[] = [];
  const mutex = new Mutex();
  const referralGates = new Map<string, Mutex>();
  const referrerGates = new Map<string, Mutex>();

  function gateFor(gates: Map<string, Mutex>, key: string): Mutex {
    const existing = gates.get(key);
    if (existing) return existing;
    const created = new Mutex();
    gates.set(key, created);
    return created;
  }

  function findCode(raw: string): ReferralCodeRecord | undefined {
    const normalized = normalizeReferralCode(raw);
    if (!normalized) return undefined;
    return codes.find((row) => row.code === normalized);
  }

  function expireCredits(now: Date) {
    for (const credit of credits) {
      if ((credit.status === "available" || credit.status === "reserved") && now.getTime() >= credit.expiresAt.getTime()) {
        credit.status = "expired";
        for (const redemption of redemptions) {
          if (redemption.referralCreditId === credit.id && redemption.status === "reserved") {
            redemption.status = "voided";
          }
        }
      }
    }
  }

  function referrerCreditsInWindow(referrerCustomerId: string, now: Date): CreditRecord[] {
    const start = capWindowStart(now).getTime();
    return credits.filter(
      (credit) =>
        credit.beneficiaryCustomerId === referrerCustomerId &&
        credit.beneficiaryRole === "referrer" &&
        credit.status !== "voided" &&
        credit.issuedAt.getTime() > start
    );
  }

  async function issueCredits(referral: ReferralRecord, now: Date): Promise<CreditRecord[]> {
    const already = credits.filter((credit) => credit.referralId === referral.id);
    if (already.length > 0) {
      referral.status = referral.reviewFlags.length > 0 ? "review" : "credited";
      return already;
    }

    const issuedAt = new Date(now.getTime());
    const expiresAt = addDays(issuedAt, REFERRAL_CREDIT_EXPIRY_DAYS);
    const created: CreditRecord[] = [];
    const friend: CreditRecord = {
      id: randomUUID(),
      beneficiaryCustomerId: referral.referredCustomerId,
      referralId: referral.id,
      beneficiaryRole: "friend",
      amount: REFERRAL_CREDIT_DOLLARS,
      issuedAt,
      expiresAt,
      status: "available",
    };
    credits.push(friend);
    created.push(friend);

    if (referral.codeType === "customer" && referral.referrerCustomerId) {
      const referrerId = referral.referrerCustomerId;
      // Same critical section as sync_referral_qualification locking the
      // referrer customer row: count and insert cannot interleave.
      const referrerCredit = await gateFor(referrerGates, referrerId).run(async () => {
        await Promise.resolve();
        const used = referrerCreditsInWindow(referrerId, now).length;
        if (used >= REFERRER_CREDIT_CAP) return null;
        const referrer: CreditRecord = {
          id: randomUUID(),
          beneficiaryCustomerId: referrerId,
          referralId: referral.id,
          beneficiaryRole: "referrer",
          amount: REFERRAL_CREDIT_DOLLARS,
          issuedAt,
          expiresAt,
          status: "available",
        };
        credits.push(referrer);
        return referrer;
      });
      if (referrerCredit) created.push(referrerCredit);
    }

    referral.status = referral.reviewFlags.length > 0 ? "review" : "credited";
    return created;
  }

  return {
    codes,
    referrals,
    credits,
    redemptions,
    audits,

    async issueCustomerCode(customerId: string): Promise<ReferralCodeRecord> {
      return mutex.run(async () => {
        const allocated = await allocateCustomerReferralCode({
          findExisting: async () => codes.find((row) => row.codeType === "customer" && row.referrerCustomerId === customerId) ?? null,
          tryInsert: async (code) => {
            if (codes.some((row) => row.code === code)) throw new ReferralCodeCollision();
            if (codes.some((row) => row.codeType === "customer" && row.referrerCustomerId === customerId)) {
              throw new Error("CUSTOMER_CODE_EXISTS");
            }
            const row: ReferralCodeRecord = {
              id: randomUUID(),
              code,
              codeType: "customer",
              referrerCustomerId: customerId,
              issuedByAdminUserId: null,
              active: true,
            };
            codes.push(row);
            return row;
          },
        });
        return codes.find((row) => row.code === allocated.code) as ReferralCodeRecord;
      });
    },

    async issueAdminCode(adminUserId: string): Promise<ReferralCodeRecord> {
      return mutex.run(async () => {
        const allocated = await allocateCustomerReferralCode({
          findExisting: async () => null,
          tryInsert: async (code) => {
            if (codes.some((row) => row.code === code)) throw new ReferralCodeCollision();
            const row: ReferralCodeRecord = {
              id: randomUUID(),
              code,
              codeType: "admin_issued",
              referrerCustomerId: null,
              issuedByAdminUserId: adminUserId,
              active: true,
            };
            codes.push(row);
            audits.push({
              id: randomUUID(),
              actorAdminUserId: adminUserId,
              actionType: "code_issued",
              targetId: row.id,
              reason: null,
              createdAt: new Date(),
            });
            return row;
          },
          generate: generateReferralCode,
        });
        return codes.find((row) => row.code === allocated.code) as ReferralCodeRecord;
      });
    },

    async setCodeActive(codeId: string, active: boolean, adminUserId: string, reason: string | null): Promise<void> {
      return mutex.run(() => {
        const row = codes.find((item) => item.id === codeId);
        if (!row) throw new Error("UNKNOWN_CODE");
        row.active = active;
        audits.push({
          id: randomUUID(),
          actorAdminUserId: adminUserId,
          actionType: active ? "code_enabled" : "code_disabled",
          targetId: row.id,
          reason,
          createdAt: new Date(),
        });
      });
    },

    async attribute(input: AttributeInput): Promise<AttributeResult> {
      return mutex.run(() => {
        const code = findCode(input.code);
        if (!code) return { ok: false, reason: "UNKNOWN_CODE" };
        if (!code.active) return { ok: false, reason: "INACTIVE_CODE" };

        if (
          code.referrerCustomerId === input.friendCustomerId ||
          sameIdentity(code.referrerCustomerId ? input.referrerEmail : null, input.friendEmail) ||
          sameIdentity(code.referrerCustomerId ? input.referrerPhone : null, input.friendPhone)
        ) {
          return { ok: false, reason: "SELF_REFERRAL" };
        }

        const existing = referrals.find((row) => row.referredCustomerId === input.friendCustomerId);
        if (existing) {
          if (existing.referralCodeId === code.id) {
            return { ok: true, referralId: existing.id, referralCodeId: code.id, flags: existing.reviewFlags };
          }
          return { ok: false, reason: "NOT_NEW_CUSTOMER" };
        }
        if (input.friendHasCompletedService) return { ok: false, reason: "NOT_NEW_CUSTOMER" };
        if (input.householdKey && referrals.some((row) => row.householdKey === input.householdKey)) {
          return { ok: false, reason: "NOT_NEW_CUSTOMER" };
        }

        const flags: ReviewFlag[] = [];
        if (input.householdKey && input.referrerAddresses.includes(input.householdKey)) flags.push("shared_address");
        if (
          input.friendPaymentMethodId &&
          input.referrerPaymentMethodId &&
          input.friendPaymentMethodId === input.referrerPaymentMethodId
        ) {
          flags.push("shared_payment");
        }

        const referral: ReferralRecord = {
          id: randomUUID(),
          referralCodeId: code.id,
          code: code.code,
          codeType: code.codeType,
          referrerCustomerId: code.referrerCustomerId,
          referredCustomerId: input.friendCustomerId,
          householdKey: input.householdKey,
          qualifyingServiceVisitId: null,
          quoteRequestId: input.quoteRequestId,
          agreedQuoteInvitationId: input.agreedQuoteInvitationId,
          bookingOrderId: input.bookingOrderId,
          status: flags.length > 0 ? "review" : "attributed",
          reviewFlags: flags,
        };
        referrals.push(referral);
        return { ok: true, referralId: referral.id, referralCodeId: code.id, flags };
      });
    },

    async syncQualification(input: QualificationInput): Promise<{ issuedCreditIds: string[] }> {
      const referral = referrals.find((row) => row.referredCustomerId === input.customerId);
      if (!referral || referral.status === "rejected") return { issuedCreditIds: [] };

      return gateFor(referralGates, referral.id).run(async () => {
        if (!referral.qualifyingServiceVisitId) {
          if (input.priorCompletedVisitCount > 0) return { issuedCreditIds: [] };
          referral.qualifyingServiceVisitId = input.visitId;
        }
        if (referral.qualifyingServiceVisitId !== input.visitId) return { issuedCreditIds: [] };
        if (!input.completed || !input.fullyPaid) return { issuedCreditIds: [] };

        const issued = await issueCredits(referral, input.now);
        return { issuedCreditIds: issued.map((credit) => credit.id) };
      });
    },

    async reserve(input: ReserveInput): Promise<{ amount: number }> {
      return mutex.run(() => {
        expireCredits(input.now);
        const active = redemptions.find(
          (row) => row.serviceVisitId === input.visitId && (row.status === "reserved" || row.status === "consumed")
        );
        if (active) {
          const credit = credits.find((row) => row.id === active.referralCreditId);
          if (credit?.beneficiaryCustomerId === input.customerId && credit.status !== "voided" && credit.status !== "expired") {
            return { amount: active.amount };
          }
          return { amount: 0 };
        }

        const candidates = credits
          .filter((credit) => credit.beneficiaryCustomerId === input.customerId && credit.status === "available")
          .sort((left, right) => left.expiresAt.getTime() - right.expiresAt.getTime());

        for (const credit of candidates) {
          const referral = referrals.find((row) => row.id === credit.referralId);
          if (!referral) continue;
          const block = referralRedemptionBlockReason({
            role: credit.beneficiaryRole,
            visitId: input.visitId,
            qualifyingVisitId: referral.qualifyingServiceVisitId,
            priorCompletedVisitCount: input.priorCompletedVisitCount,
            prepaidPackageId: input.prepaidPackageId,
            baseAmount: input.baseAmount,
            customDiscountAmount: input.customDiscountAmount,
            discountProgram: input.discountProgram,
            pricingSnapshot: input.pricingSnapshot,
            scopePricingSnapshot: input.scopePricingSnapshot,
            bookingPricingSnapshot: input.bookingPricingSnapshot,
            addOnAmount: input.addOnAmount,
            customChargeAmount: input.customChargeAmount,
            customAdjustments: input.customAdjustments,
            taxAmount: input.taxAmount,
            tipAmount: input.tipAmount,
          });
          if (block) continue;
          credit.status = "reserved";
          redemptions.push({
            id: randomUUID(),
            referralCreditId: credit.id,
            serviceVisitId: input.visitId,
            amount: credit.amount,
            status: "reserved",
            eligibleCleaningAmount: assessReferralPricing(input).eligibleCleaningAmount,
          });
          return { amount: credit.amount };
        }
        return { amount: 0 };
      });
    },

    async consume(visitId: string): Promise<void> {
      return mutex.run(() => {
        const redemption = redemptions.find((row) => row.serviceVisitId === visitId && row.status === "reserved");
        if (!redemption) return;
        redemption.status = "consumed";
        const credit = credits.find((row) => row.id === redemption.referralCreditId);
        if (credit && credit.status === "reserved") credit.status = "redeemed";
      });
    },

    async restoreOnCancel(visitId: string, now: Date): Promise<void> {
      return mutex.run(() => {
        const redemption = redemptions.find(
          (row) => row.serviceVisitId === visitId && (row.status === "reserved" || row.status === "consumed")
        );
        if (!redemption) return;
        redemption.status = "restored";
        const credit = credits.find((row) => row.id === redemption.referralCreditId);
        if (!credit || credit.status === "voided" || credit.status === "review") return;
        const originalExpiry = credit.expiresAt;
        credit.status = now.getTime() >= originalExpiry.getTime() ? "expired" : "available";
        credit.expiresAt = originalExpiry;
      });
    },

    async reverseQualifyingVisit(visitId: string): Promise<void> {
      return mutex.run(() => {
        const referral = referrals.find((row) => row.qualifyingServiceVisitId === visitId);
        if (referral) {
          for (const credit of credits.filter((row) => row.referralId === referral.id)) {
            if (credit.status === "redeemed" || credit.status === "review") {
              credit.status = "review";
            } else if (credit.status === "available" || credit.status === "reserved" || credit.status === "expired") {
              credit.status = "voided";
              for (const redemption of redemptions) {
                if (redemption.referralCreditId === credit.id && (redemption.status === "reserved" || redemption.status === "consumed")) {
                  redemption.status = "voided";
                }
              }
            }
          }
        }

        const usedHere = redemptions.find((row) => row.serviceVisitId === visitId && row.status === "consumed");
        if (usedHere) {
          const credit = credits.find((row) => row.id === usedHere.referralCreditId);
          if (credit) credit.status = "review";
        }
      });
    },

    customerView(customerId: string, now: Date) {
      expireCredits(now);
      const code = codes.find((row) => row.codeType === "customer" && row.referrerCustomerId === customerId && row.active) ?? null;
      const available = credits.filter(
        (credit) => credit.beneficiaryCustomerId === customerId && credit.status === "available" && creditVisible(credit, customerId)
      );
      return { code, credits: available };
    },
  };
}

function creditVisible(credit: CreditRecord, customerId: string): boolean {
  return credit.beneficiaryCustomerId === customerId;
}

export function isFullyPaidVisit(input: {
  paymentStatus: string | null;
  paymentRowStatus: string | null;
  amountDueFromCustomer: number;
  prepaidPackageId: string | null;
  packageStatus: string | null;
}): boolean {
  if (input.paymentRowStatus === "paid" || input.paymentStatus === "paid") return true;
  if (input.amountDueFromCustomer > 0) return false;
  if (input.prepaidPackageId && input.packageStatus && input.packageStatus !== "cancelled") {
    return input.paymentStatus === "not_applicable" || input.paymentStatus === "paid" || input.paymentStatus == null;
  }
  return false;
}
