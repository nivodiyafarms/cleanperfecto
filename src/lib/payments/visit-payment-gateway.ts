import "server-only";

import { getStripeClient } from "@/lib/booking/stripe/client";
import { RESIDENTIAL_CLEANING_TAX_CODE } from "@/lib/booking/stripe/checkout-sessions";
import { assertCanCalculateStripeTax, assertCanCreateStripeCharge } from "@/lib/config/payment-capabilities";
import { OPTIONAL_GRATUITY_TAX_CODE } from "./tax-codes";

export interface TaxLocationAddress {
  line1: string | null;
  line2: string | null;
  city: string | null;
  state: string | null;
  zip: string;
}

export interface CreateTaxCalculationInput {
  /** Positive collectible service/extras amount, in cents. */
  serviceAmountCents: number;
  /** Positive tip amount, in cents — omit the gratuity line entirely when 0 (never send a zero-value line item). */
  tipAmountCents: number;
  address: TaxLocationAddress;
}

export interface TaxCalculationResult {
  id: string;
  taxAmountExclusiveCents: number;
  amountTotalCents: number;
  expiresAt: Date | null;
}

export interface CreatePaymentIntentInput {
  stripeCustomerId: string;
  stripePaymentMethodId: string;
  amountCents: number;
  stripeTaxCalculationId: string;
  metadata: Record<string, string>;
  idempotencyKey: string;
}

export interface PaymentIntentResult {
  id: string;
  clientSecret: string | null;
  status: string;
}

export interface TaxTransactionAttemptResult {
  committedTransactionId: string | null;
  erroredReason: string | null;
}

/**
 * Everything this milestone needs from Stripe (Tax Calculations, PaymentIntents,
 * Tax Association reconciliation, and the one legitimate manual Tax
 * Transaction path for external/off-Stripe settlements) behind one small,
 * fakeable interface — same DI shape as SignedConsentDocumentStore. No
 * off_session/confirm:true anywhere here: this is the on-session flow, the
 * customer confirms client-side via Stripe.js.
 */
export interface VisitPaymentGateway {
  createTaxCalculation(input: CreateTaxCalculationInput): Promise<TaxCalculationResult>;
  createPaymentIntent(input: CreatePaymentIntentInput): Promise<PaymentIntentResult>;
  retrievePaymentIntent(id: string): Promise<PaymentIntentResult>;
  /** Read-only reconciliation for the stripe_card rail — never creates anything. */
  findTaxAssociation(paymentIntentId: string): Promise<TaxTransactionAttemptResult | null>;
  /** The one legitimate manual Tax Transaction path — for an external (zelle/cash) settlement ONLY, never for stripe_card. Idempotent via the caller-supplied idempotencyKey. */
  createTaxTransactionFromCalculation(params: { calculationId: string; reference: string; idempotencyKey: string }): Promise<{ id: string }>;
}

function buildLineItems(input: CreateTaxCalculationInput) {
  const lineItems = [
    {
      amount: input.serviceAmountCents,
      reference: "service",
      tax_code: RESIDENTIAL_CLEANING_TAX_CODE,
    },
  ];
  if (input.tipAmountCents > 0) {
    lineItems.push({
      amount: input.tipAmountCents,
      reference: "tip",
      tax_code: OPTIONAL_GRATUITY_TAX_CODE,
    });
  }
  return lineItems;
}

export function createStripeVisitPaymentGateway(): VisitPaymentGateway {
  const stripe = getStripeClient();

  return {
    async createTaxCalculation(input) {
      assertCanCalculateStripeTax();
      const calculation = await stripe.tax.calculations.create({
        currency: "usd",
        line_items: buildLineItems(input),
        customer_details: {
          address: {
            line1: input.address.line1 ?? undefined,
            line2: input.address.line2 ?? undefined,
            city: input.address.city ?? undefined,
            state: input.address.state ?? undefined,
            postal_code: input.address.zip,
            country: "US",
          },
          address_source: "shipping",
        },
      });
      if (!calculation.id) {
        throw new Error("[payments] Stripe Tax Calculation was created with no id");
      }
      return {
        id: calculation.id,
        taxAmountExclusiveCents: calculation.tax_amount_exclusive,
        amountTotalCents: calculation.amount_total,
        expiresAt: calculation.expires_at ? new Date(calculation.expires_at * 1000) : null,
      };
    },

    async createPaymentIntent(input) {
      assertCanCreateStripeCharge();
      const intent = await stripe.paymentIntents.create(
        {
          amount: input.amountCents,
          currency: "usd",
          customer: input.stripeCustomerId,
          payment_method: input.stripePaymentMethodId,
          // Card-only, no redirects: the customer confirms via Stripe.js
          // confirmCardPayment (see VisitPaymentFlow.tsx), never a redirect
          // flow, so there is no return_url anywhere in this flow. Without
          // this, Stripe's default automatic_payment_methods pulls in
          // whatever redirect-capable methods (Klarna/Cashapp/Link/etc.) are
          // enabled on the Dashboard and refuses to confirm at all without a
          // return_url — confirmed against real Stripe TEST mode.
          payment_method_types: ["card"],
          hooks: { inputs: { tax: { calculation: input.stripeTaxCalculationId } } },
          metadata: input.metadata,
        },
        { idempotencyKey: input.idempotencyKey }
      );
      return { id: intent.id, clientSecret: intent.client_secret, status: intent.status };
    },

    async retrievePaymentIntent(id) {
      const intent = await stripe.paymentIntents.retrieve(id);
      return { id: intent.id, clientSecret: intent.client_secret, status: intent.status };
    },

    async findTaxAssociation(paymentIntentId) {
      const association = await stripe.tax.associations.find({ payment_intent: paymentIntentId });
      if (!association.tax_transaction_attempts || association.tax_transaction_attempts.length === 0) {
        return null;
      }
      const latest = association.tax_transaction_attempts[association.tax_transaction_attempts.length - 1];
      return {
        committedTransactionId: latest.committed?.transaction ?? null,
        erroredReason: latest.errored?.reason ?? null,
      };
    },

    async createTaxTransactionFromCalculation(params) {
      assertCanCalculateStripeTax();
      const transaction = await stripe.tax.transactions.createFromCalculation(
        { calculation: params.calculationId, reference: params.reference },
        { idempotencyKey: params.idempotencyKey }
      );
      return { id: transaction.id };
    },
  };
}
