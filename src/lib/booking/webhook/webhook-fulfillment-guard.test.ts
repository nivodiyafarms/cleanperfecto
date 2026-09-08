import { describe, expect, it } from "vitest";
import { resolveWebhookFulfillmentDecision } from "./webhook-fulfillment-guard";

describe("resolveWebhookFulfillmentDecision", () => {
  it("blocks all fulfillment under disabled, regardless of livemode", () => {
    expect(resolveWebhookFulfillmentDecision("disabled", { livemode: false }).allowed).toBe(false);
    expect(resolveWebhookFulfillmentDecision("disabled", { livemode: true }).allowed).toBe(false);
  });

  it("blocks all fulfillment under external_only, regardless of livemode", () => {
    expect(resolveWebhookFulfillmentDecision("external_only", { livemode: false }).allowed).toBe(false);
    expect(resolveWebhookFulfillmentDecision("external_only", { livemode: true }).allowed).toBe(false);
  });

  it("stripe_sandbox allows a test-mode event", () => {
    expect(resolveWebhookFulfillmentDecision("stripe_sandbox", { livemode: false }).allowed).toBe(true);
  });

  it("stripe_sandbox rejects a live-mode event — explicit mode mismatch", () => {
    const decision = resolveWebhookFulfillmentDecision("stripe_sandbox", { livemode: true });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/LIVE-mode/);
  });

  it("stripe_enabled allows a live-mode event", () => {
    expect(resolveWebhookFulfillmentDecision("stripe_enabled", { livemode: true }).allowed).toBe(true);
  });

  it("stripe_enabled rejects a test-mode event — explicit mode mismatch", () => {
    const decision = resolveWebhookFulfillmentDecision("stripe_enabled", { livemode: false });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/TEST-mode/);
  });
});
