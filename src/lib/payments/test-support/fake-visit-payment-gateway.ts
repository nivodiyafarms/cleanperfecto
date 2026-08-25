import { randomUUID } from "node:crypto";
import type {
  CreatePaymentIntentInput,
  CreateTaxCalculationInput,
  PaymentIntentResult,
  TaxCalculationResult,
  TaxTransactionAttemptResult,
  VisitPaymentGateway,
} from "../visit-payment-gateway";

export interface FakeVisitPaymentGatewayOptions {
  /** Basis points, e.g. 825 = 8.25%. Applied to (service + tip). Default 825 — a realistic but entirely test-only rate, never meant to resemble a real jurisdiction's rate. */
  taxRateBps?: number;
  /** Default 5400s (90 min) — Stripe Tax Calculations are not valid indefinitely; this fake mirrors that so expiration-handling tests are meaningful. */
  calculationValiditySeconds?: number;
  /** Status returned by the next createPaymentIntent call — default "requires_confirmation" (an on-session intent awaiting client-side confirmation). Set to "requires_action" or throw via failNextPaymentIntentCreate to simulate other outcomes. */
  nextPaymentIntentStatus?: string;
  failNextPaymentIntentCreate?: boolean;
  failNextTaxTransactionCreate?: boolean;
}

interface FakeCalculation {
  id: string;
  serviceAmountCents: number;
  tipAmountCents: number;
  taxAmountExclusiveCents: number;
  amountTotalCents: number;
  expiresAt: Date | null;
}

export interface FakeVisitPaymentGatewayState {
  calculations: Map<string, FakeCalculation>;
  paymentIntents: Map<string, { status: string; amountCents: number; stripeTaxCalculationId: string }>;
  /** Test-settable: what findTaxAssociation should report for a given PaymentIntent id. Absent = "not yet found" (null). */
  taxAssociationByPaymentIntentId: Map<string, TaxTransactionAttemptResult>;
  taxTransactionsByReference: Map<string, { calculationId: string }>;
  createTaxCalculationCallCount: number;
  createPaymentIntentCallCount: number;
  createTaxTransactionCallCount: number;
}

/**
 * In-memory VisitPaymentGateway for unit tests — real, deterministic tax
 * math and expiration modeling (so expiration-handling tests are genuine),
 * with injectable failure simulation for the Stripe-outage/decline/tax-
 * sync-failure scenarios. No network calls, no real Stripe SDK involved.
 */
export function createFakeVisitPaymentGateway(options: FakeVisitPaymentGatewayOptions = {}): { gateway: VisitPaymentGateway; state: FakeVisitPaymentGatewayState } {
  const taxRateBps = options.taxRateBps ?? 825;
  const calculationValiditySeconds = options.calculationValiditySeconds ?? 5400;
  let failNextPaymentIntentCreate = options.failNextPaymentIntentCreate ?? false;
  let failNextTaxTransactionCreate = options.failNextTaxTransactionCreate ?? false;

  const state: FakeVisitPaymentGatewayState = {
    calculations: new Map(),
    paymentIntents: new Map(),
    taxAssociationByPaymentIntentId: new Map(),
    taxTransactionsByReference: new Map(),
    createTaxCalculationCallCount: 0,
    createPaymentIntentCallCount: 0,
    createTaxTransactionCallCount: 0,
  };

  const gateway: VisitPaymentGateway = {
    async createTaxCalculation(input: CreateTaxCalculationInput): Promise<TaxCalculationResult> {
      state.createTaxCalculationCallCount += 1;
      const id = `taxcalc_${randomUUID()}`;
      const taxable = input.serviceAmountCents + input.tipAmountCents;
      const taxAmountExclusiveCents = Math.round((taxable * taxRateBps) / 10000);
      const amountTotalCents = taxable + taxAmountExclusiveCents;
      const expiresAt = new Date(Date.now() + calculationValiditySeconds * 1000);
      const record: FakeCalculation = { id, serviceAmountCents: input.serviceAmountCents, tipAmountCents: input.tipAmountCents, taxAmountExclusiveCents, amountTotalCents, expiresAt };
      state.calculations.set(id, record);
      return { id, taxAmountExclusiveCents, amountTotalCents, expiresAt };
    },

    async createPaymentIntent(input: CreatePaymentIntentInput): Promise<PaymentIntentResult> {
      state.createPaymentIntentCallCount += 1;
      if (failNextPaymentIntentCreate) {
        failNextPaymentIntentCreate = false;
        throw new Error("[fake-visit-payment-gateway] simulated PaymentIntent creation failure");
      }
      const id = `pi_${randomUUID()}`;
      const status = options.nextPaymentIntentStatus ?? "requires_confirmation";
      state.paymentIntents.set(id, { status, amountCents: input.amountCents, stripeTaxCalculationId: input.stripeTaxCalculationId });
      return { id, clientSecret: `${id}_secret_test`, status };
    },

    async retrievePaymentIntent(id: string): Promise<PaymentIntentResult> {
      const record = state.paymentIntents.get(id);
      if (!record) throw new Error(`[fake-visit-payment-gateway] unknown PaymentIntent ${id}`);
      return { id, clientSecret: `${id}_secret_test`, status: record.status };
    },

    async findTaxAssociation(paymentIntentId: string): Promise<TaxTransactionAttemptResult | null> {
      return state.taxAssociationByPaymentIntentId.get(paymentIntentId) ?? null;
    },

    async createTaxTransactionFromCalculation(params: { calculationId: string; reference: string; idempotencyKey: string }): Promise<{ id: string }> {
      state.createTaxTransactionCallCount += 1;
      if (failNextTaxTransactionCreate) {
        failNextTaxTransactionCreate = false;
        throw new Error("[fake-visit-payment-gateway] simulated Stripe Tax transaction creation failure");
      }
      const existing = state.taxTransactionsByReference.get(params.reference);
      if (existing) return { id: `txn_${params.reference}` };
      state.taxTransactionsByReference.set(params.reference, { calculationId: params.calculationId });
      return { id: `txn_${params.reference}` };
    },
  };

  return { gateway, state };
}
