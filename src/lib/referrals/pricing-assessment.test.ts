import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildServiceVisitInvoiceAndReceipt } from "@/lib/invoicing/build-service-visit-invoice";
import { calculateEstimate } from "@/lib/pricing/calculate-estimate";
import { roundToCents } from "@/lib/pricing/money";
import { resolveCustomerBookingPrice } from "@/lib/pricing/customer-booking-price";
import type { CalculationInput, CalculationResult } from "@/lib/pricing/types";
import type { ServiceVisitPaymentRow, ServiceVisitPricingRow, ServiceVisitRow } from "@/lib/scheduling/domain-types";
import { REFERRAL_MIN_CLEANING_DOLLARS } from "./constants";
import { referralRedemptionBlockReason } from "./eligibility";
import { assessReferralPricing } from "./pricing-assessment";

const AS_OF = new Date("2026-11-01T18:00:00.000Z");

function quoteInput(overrides: Partial<CalculationInput> = {}): CalculationInput {
  return {
    propertyKind: "home",
    cleaningType: "standard",
    condition: "light",
    sizeTier: "2br_2ba",
    zip: "75056",
    frequency: "one_time",
    isPrepaidPackage: false,
    visitCount: 1,
    addOnIds: [],
    firstCleaningEligible: false,
    asOf: AS_OF,
    ...overrides,
  };
}

function visitSnapshot(input: CalculationInput, result: CalculationResult, baseAmount: number) {
  return {
    addOnIds: input.addOnIds,
    priced: result.pricedAddOns,
    baseAmount,
    baseSource: "booking_order",
    bookingOrderId: "booking-1",
    bookingOrderPricingSnapshot: { input, result },
  };
}

function blockFor(input: CalculationInput, result: CalculationResult, extras: Parameters<typeof assessReferralPricing>[0] = {}) {
  const bookingPrice = resolveCustomerBookingPrice(result);
  return referralRedemptionBlockReason({
    role: "referrer",
    visitId: "visit-2",
    qualifyingVisitId: "visit-1",
    priorCompletedVisitCount: 2,
    prepaidPackageId: null,
    baseAmount: bookingPrice,
    customDiscountAmount: 0,
    discountProgram: "none",
    pricingSnapshot: visitSnapshot(input, result, bookingPrice),
    addOnAmount: result.pricedAddOnsTotal,
    customChargeAmount: extras.customChargeAmount,
    customAdjustments: extras.customAdjustments,
    taxAmount: extras.taxAmount,
    tipAmount: extras.tipAmount,
    ...extras,
  });
}

describe("referral $150 cleaning price", () => {
  it("ignores add-ons, customization, travel, supplies, tax, tips, and excluded charges", () => {
    const plain = quoteInput();
    const plainResult = calculateEstimate(plain);
    const input = quoteInput({
      addOnIds: ["inside_oven"],
      specialRooms: ["game_room"],
      outdoorSelection: { porchSqFt: 40 },
      quantifiedAddOns: [{ id: "interior_window_detailing", quantity: 2 }],
    });
    const result = calculateEstimate(input);
    const bookingPrice = resolveCustomerBookingPrice(result);

    expect(result.pricedAddOnsTotal).toBeGreaterThan(0);
    expect(result.specialRoomChargesTotal).toBeGreaterThan(0);
    expect(result.outdoorChargesTotal).toBeGreaterThan(0);
    expect(result.quantifiedAddOnsTotal).toBeGreaterThan(0);
    expect(result.suppliesEquipmentCharge).toBeGreaterThan(0);
    expect(result.cleaningSubtotal).toBeGreaterThanOrEqual(REFERRAL_MIN_CLEANING_DOLLARS);
    expect(result.calculatedTotal).toBeGreaterThanOrEqual(REFERRAL_MIN_CLEANING_DOLLARS);
    expect(bookingPrice).toBeGreaterThanOrEqual(REFERRAL_MIN_CLEANING_DOLLARS);

    const assessment = assessReferralPricing({
      pricingSnapshot: visitSnapshot(input, result, bookingPrice),
      baseAmount: bookingPrice,
      addOnAmount: result.pricedAddOnsTotal + 30,
      customChargeAmount: 45,
      taxAmount: 18,
      tipAmount: 25,
    });
    const specialPortion = result.specialRoomChargesTotal * result.squareFootageMultiplier * result.conditionMultiplier;
    expect(assessment.eligibleCleaningAmount).toBe(roundToCents(result.cleaningSubtotal - specialPortion));
    expect(assessment.eligibleCleaningAmount).toBe(plainResult.cleaningSubtotal);
    expect(assessment.eligibleCleaningAmount).toBeLessThan(REFERRAL_MIN_CLEANING_DOLLARS);
    expect(assessment.stackingBlocked).toBe(false);
    expect(blockFor(input, result, { customChargeAmount: 45, taxAmount: 18, tipAmount: 25 })).toBe("BELOW_MINIMUM");

    const pricing = {
      id: "pricing-1",
      serviceVisitId: "visit-1",
      pricingVersion: result.pricingVersion,
      pricingSnapshot: visitSnapshot(input, result, bookingPrice),
      baseAmount: bookingPrice,
      addOnIds: ["inside_oven" as const],
      addOnAmount: 30,
      customAdjustments: [
        {
          id: "adj-1",
          type: "custom_charge" as const,
          description: "Extra garage clean",
          amount: 45,
          addedByAdminUserId: "admin:1",
          addedByRole: "operations",
          addedAt: new Date("2026-11-01T18:00:00.000Z"),
        },
      ],
      customChargeAmount: 45,
      customDiscountAmount: 0,
      totalAmount: bookingPrice + 75,
      amountDueFromCustomer: bookingPrice + 75,
      priceStatus: "confirmed" as const,
      requiresCustomerApproval: false,
      previouslyApprovedAmount: null,
      revisionNumber: 0,
      paymentStatus: "paid" as const,
      confirmedAt: new Date("2026-11-01T18:00:00.000Z"),
      confirmedBy: "admin:1",
    } satisfies ServiceVisitPricingRow;
    const visit = {
      id: "visit-1",
      customerId: "customer-1",
      quoteRequestId: null,
      bookingOrderId: "booking-1",
      prepaidPackageId: null,
      recurringScheduleId: null,
      visitNumber: null,
      cleaningType: "standard" as const,
      frequency: "one_time" as const,
      status: "completed" as const,
      requestedStartAt: null,
      confirmedAt: null,
      confirmedStartAt: null,
      confirmedEndAt: null,
      estimatedLaborMinutes: null,
      estimatedServiceMinutes: null,
      recommendedCleanerCount: null,
      turnaroundBufferMinutes: null,
      timezone: "America/Chicago",
      workFinishedAt: null,
      completedAt: new Date("2026-11-01T18:00:00.000Z"),
      cancelledAt: null,
      serviceAddressLine1: "10 Oak St",
      serviceAddressLine2: null,
      serviceCity: "Frisco",
      serviceState: "TX",
      serviceAddressIdentity: "75056|10 OAK ST|",
      reviewRequestSuppressed: false,
    } satisfies ServiceVisitRow;
    const payment = {
      id: "payment-1",
      serviceVisitId: "visit-1",
      serviceVisitPricingId: "pricing-1",
      approvedAmount: pricing.amountDueFromCustomer,
      referralCreditAmount: 0,
      tipBasisAmount: bookingPrice,
      tipSelectionType: "percentage_15" as const,
      tipPercentage: 15,
      tipAmount: 25,
      taxAmount: 18,
      totalAmount: pricing.amountDueFromCustomer + 43,
      tipSelectedAt: new Date("2026-11-01T18:00:00.000Z"),
      tipConfirmedAt: new Date("2026-11-01T18:00:00.000Z"),
      taxLocationSnapshot: null,
      currency: "usd",
      paymentMethodType: "stripe_card" as const,
      stripeCustomerId: null,
      stripePaymentMethodId: null,
      cardBrand: null,
      cardLast4: null,
      stripePaymentIntentId: null,
      stripeTaxCalculationId: null,
      taxCalculationExpiresAt: null,
      taxTransactionStatus: "not_applicable" as const,
      stripeTaxTransactionId: null,
      taxTransactionFailureCode: null,
      taxTransactionFailureMessage: null,
      taxTransactionLastAttemptAt: null,
      externalPaymentReference: null,
      status: "paid" as const,
      idempotencyKey: "idem-1",
      failureCode: null,
      failureMessage: null,
      refundedAmount: 0,
      refundedAt: null,
      paidAt: new Date("2026-11-01T18:00:00.000Z"),
      createdAt: new Date("2026-11-01T18:00:00.000Z"),
      updatedAt: new Date("2026-11-01T18:00:00.000Z"),
    } satisfies ServiceVisitPaymentRow;
    const { invoiceInput, receiptInput } = buildServiceVisitInvoiceAndReceipt({
      visit,
      pricing,
      customerDisplayName: "Jane Doe",
      payment,
    });
    expect(invoiceInput.subtotalAmount).toBeGreaterThanOrEqual(REFERRAL_MIN_CLEANING_DOLLARS);
    expect(invoiceInput.totalAmount).toBe(invoiceInput.subtotalAmount + payment.taxAmount);
    expect(receiptInput.tipPaid).toBe(25);
    expect(assessment.eligibleCleaningAmount).toBeLessThan(invoiceInput.baseAmount);
    expect(assessment.eligibleCleaningAmount).toBeLessThan(invoiceInput.subtotalAmount);
  });

  it("reflects a normal recurring rate and still excludes supplies from the minimum", () => {
    const below = calculateEstimate(quoteInput({ sizeTier: "3br_2ba", frequency: "weekly" }));
    const above = calculateEstimate(quoteInput({ sizeTier: "4br_plus", frequency: "weekly" }));

    expect(below.discountProgram).toBe("recurring_cycle");
    expect(below.cleaningSubtotal).toBeGreaterThanOrEqual(REFERRAL_MIN_CLEANING_DOLLARS);
    expect(below.calculatedTotal).toBeGreaterThanOrEqual(REFERRAL_MIN_CLEANING_DOLLARS);
    const belowAssessment = assessReferralPricing({
      pricingSnapshot: { baseSource: "recurring_scope_version", recurringScopeVersionId: "scope-1", baseAmount: below.calculatedTotal },
      scopePricingSnapshot: { input: quoteInput({ sizeTier: "3br_2ba", frequency: "weekly" }), result: below },
      baseAmount: below.calculatedTotal,
    });
    expect(belowAssessment.eligibleCleaningAmount).toBe(roundToCents(below.cleaningSubtotal - below.recurringAdjustment));
    expect(belowAssessment.eligibleCleaningAmount).toBeLessThan(REFERRAL_MIN_CLEANING_DOLLARS);
    expect(belowAssessment.stackingBlocked).toBe(false);

    expect(above.discountProgram).toBe("recurring_cycle");
    const aboveAssessment = assessReferralPricing({
      bookingPricingSnapshot: { input: quoteInput({ sizeTier: "4br_plus", frequency: "weekly" }), result: above },
      baseAmount: 0,
      discountProgram: "first_cleaning",
    });
    expect(aboveAssessment.stackingBlocked).toBe(false);
    expect(aboveAssessment.eligibleCleaningAmount).toBeGreaterThanOrEqual(REFERRAL_MIN_CLEANING_DOLLARS);
    expect(aboveAssessment.eligibleCleaningAmount).toBe(roundToCents(above.cleaningSubtotal - above.recurringAdjustment));
  });
});

describe("referral promotions do not stack", () => {
  it("blocks a first-cleaning promotion from the snapshot even if the program key is removed or relabeled", () => {
    const input = quoteInput({ sizeTier: "4br_plus", firstCleaningEligible: true });
    const result = calculateEstimate(input);
    expect(result.discountProgram).toBe("first_cleaning");
    expect(result.firstCleaningDiscount).toBeGreaterThan(0);
    expect(result.cleaningSubtotal).toBeGreaterThanOrEqual(REFERRAL_MIN_CLEANING_DOLLARS);
    expect(blockFor(input, result)).toBe("OTHER_DISCOUNT");

    const relabeled = { ...result, discountProgram: "recurring_cycle" as const };
    expect(assessReferralPricing({ pricingSnapshot: { result: relabeled } }).stackingSignal).toBe("first_cleaning");

    const { discountProgram: _program, ...withoutKey } = result;
    void _program;
    expect(assessReferralPricing({ pricingSnapshot: { result: withoutKey } }).stackingBlocked).toBe(true);
  });

  it("blocks a prepaid package from package discount and prepaid total, not only the program name", () => {
    const input = quoteInput({
      sizeTier: "4br_plus",
      frequency: "weekly",
      isPrepaidPackage: true,
      visitCount: 6,
    });
    const result = calculateEstimate(input);
    expect(result.discountProgram).toBe("prepaid_package");
    expect(result.packageDiscount).toBeGreaterThan(0);
    expect(result.prepaidPackageTotal).toBeGreaterThan(0);
    expect(blockFor(input, result)).toBe("PREPAID_PACKAGE");

    const { discountProgram: _program, ...withoutKey } = result;
    void _program;
    expect(assessReferralPricing({ pricingSnapshot: { result: withoutKey } }).stackingSignal).toBe("prepaid_package");
  });

  it("blocks a custom promotional discount on an otherwise eligible recurring cleaning", () => {
    const input = quoteInput({ sizeTier: "4br_plus", frequency: "weekly" });
    const result = calculateEstimate(input);
    expect(result.discountProgram).toBe("recurring_cycle");
    expect(blockFor(input, result)).toBeNull();
    expect(
      blockFor(input, result, {
        customDiscountAmount: 20,
        customAdjustments: [{ type: "custom_discount", amount: 20 }],
      })
    ).toBe("OTHER_DISCOUNT");
    expect(
      assessReferralPricing({
        pricingSnapshot: visitSnapshot(input, result, resolveCustomerBookingPrice(result)),
        customDiscountAmount: 0,
        customAdjustments: [{ type: "custom_discount", amount: 15 }],
      }).stackingSignal
    ).toBe("custom_discount");
  });
});

describe("referral code grants", () => {
  it("keeps authenticated reads and leaves code changes to service_role functions", () => {
    const sql = readFileSync("supabase/migrations/20261101120000_create_referral_program.sql", "utf8");
    expect(sql).not.toMatch(/grant insert, update on public\.referral_codes to authenticated/i);
    expect(sql).not.toContain("referral_codes_owner_insert");
    expect(sql).not.toContain("referral_codes_owner_update");
    expect(sql).toMatch(/grant select on public\.referral_codes, public\.referrals, public\.referral_credits, public\.referral_redemptions\s+to authenticated/);
    expect(sql).toContain("create policy referral_codes_select");
    expect(sql).toContain("from public.customers");
    expect(sql).toContain("pg_advisory_xact_lock");
    expect(sql).toContain("referral_pricing_facts");
    expect(sql).toContain("grant execute on function public.create_customer_referral_code(uuid, text) to service_role");
    expect(sql).toContain("grant execute on function public.set_referral_code_active(uuid, boolean, uuid, text) to service_role");
  });
});

describe("referral migration isolation", () => {
  it("does not replace pre-existing shared functions", () => {
    const sql = readFileSync("supabase/migrations/20261101120000_create_referral_program.sql", "utf8");
    expect(sql).not.toMatch(/create\s+or\s+replace\s+function/i);
    expect(sql).not.toContain("function public.protect_service_visit_payments_financial_facts");
    expect(sql).not.toMatch(/public\.current_customer_id\(|public\.current_admin_is_owner\(/);
    expect(sql).toContain("create trigger service_visit_payments_protect_referral_credit_amount");
    expect(sql).toMatch(/new\.referral_credit_amount is distinct from old\.referral_credit_amount/);
  });

  it("apply script guards on the exact prior migration version", () => {
    const sql = readFileSync("docs/apply-referral-production-sql-editor.sql", "utf8");
    expect(sql).toContain("v_latest is distinct from '20261031200000'");
    expect(sql).toContain("end\n$guard$;");
  });
});
