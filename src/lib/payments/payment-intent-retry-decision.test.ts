import { describe, expect, it } from "vitest";
import { decidePaymentIntentRetry } from "./payment-intent-retry-decision";

describe("decidePaymentIntentRetry", () => {
  it.each([
    ["requires_payment_method", "reuse"],
    ["requires_confirmation", "reuse"],
    ["requires_action", "reuse"],
    ["processing", "reuse"],
    ["requires_capture", "reuse"], // not reachable in this codebase (automatic capture only), but must never trigger a fresh intent either
    ["succeeded", "reuse"], // never spin up a second intent for an already-paid PaymentIntent — the caller's own status="paid" check is the real source of truth
    ["canceled", "fresh_intent_required"], // the only Stripe status that can never be confirmed again
  ] as const)("%s -> %s", (status, expected) => {
    expect(decidePaymentIntentRetry(status)).toBe(expected);
  });

  it("defaults to reuse (never fresh_intent_required) for an unrecognized status — never allow a duplicate charge on ambiguous input", () => {
    expect(decidePaymentIntentRetry("some_future_stripe_status")).toBe("reuse");
  });
});
