/**
 * Sanitized, receipt-safe display text for how a payment was made — never a
 * raw card/bank account number, CVC, or any Stripe secret. Card/bank last4
 * is the only Stripe-sourced identifier ever surfaced, mirroring the same
 * convention already used for service_visit_payments.cardLast4 on the admin
 * visit page.
 */
export type PaymentMethodDisplayInput =
  | { rail: "stripe_card"; cardBrand: string | null; cardLast4: string | null }
  | { rail: "stripe_bank_account"; bankName: string | null; last4: string | null }
  | { rail: "zelle" }
  | { rail: "cash" };

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function formatPaymentMethodDisplay(input: PaymentMethodDisplayInput): string {
  switch (input.rail) {
    case "stripe_card": {
      const brand = input.cardBrand ? capitalize(input.cardBrand) : "Card";
      return input.cardLast4 ? `${brand} •••• ${input.cardLast4}` : brand;
    }
    case "stripe_bank_account":
      return input.last4 ? `Bank account (ACH) •••• ${input.last4}` : "Bank account (ACH)";
    case "zelle":
      return "Zelle";
    case "cash":
      return "Cash";
  }
}

/** Minimal shape of Stripe.PaymentMethod this module actually reads — kept structural rather than importing the `stripe` package here, so this module has no SDK dependency of its own. */
interface StripePaymentMethodLike {
  type: string;
  card?: { brand: string | null; last4: string | null } | null;
  us_bank_account?: { bank_name: string | null; last4: string | null } | null;
}

/** Adapts a Stripe PaymentMethod (retrieved server-side, e.g. via paymentIntents.retrieve({expand: ["payment_method"]})) to display text — never null-unsafe: falls back to a generic "Card" label when the expanded object isn't available. */
export function formatPaymentMethodDisplayFromStripe(paymentMethod: StripePaymentMethodLike | null): string {
  if (!paymentMethod) return formatPaymentMethodDisplay({ rail: "stripe_card", cardBrand: null, cardLast4: null });
  if (paymentMethod.type === "us_bank_account") {
    return formatPaymentMethodDisplay({ rail: "stripe_bank_account", bankName: paymentMethod.us_bank_account?.bank_name ?? null, last4: paymentMethod.us_bank_account?.last4 ?? null });
  }
  return formatPaymentMethodDisplay({ rail: "stripe_card", cardBrand: paymentMethod.card?.brand ?? null, cardLast4: paymentMethod.card?.last4 ?? null });
}
