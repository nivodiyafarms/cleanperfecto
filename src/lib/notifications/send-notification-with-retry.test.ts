import { describe, expect, it, vi } from "vitest";
import { createFakeEmailSender } from "./test-support/fake-email-sender";
import { sendNotificationEmailWithRetry } from "./send-notification-with-retry";

const INPUT = { to: "jordan@example.com", subject: "s", text: "t", html: "<p>h</p>", idempotencyKey: "key-1" };
const NO_WAIT = async () => {};

describe("sendNotificationEmailWithRetry", () => {
  it("marks the row sent on a first-try success, never retries", async () => {
    const email = createFakeEmailSender();
    const markSent = vi.fn();
    const markFailedTerminal = vi.fn();

    const result = await sendNotificationEmailWithRetry({ emailSender: email.sender, markSent, markFailedTerminal, sleep: NO_WAIT }, "row-1", INPUT);

    expect(result).toEqual({ ok: true });
    expect(email.state.sentEmails).toHaveLength(1);
    expect(markSent).toHaveBeenCalledWith("row-1", "fake-email-1");
    expect(markFailedTerminal).not.toHaveBeenCalled();
  });

  it("retries a transient failure and marks sent once it succeeds", async () => {
    const email = createFakeEmailSender({ behavior: (_i, n) => (n < 2 ? { sent: false, failureReason: "transient" } : undefined) });
    const markSent = vi.fn();
    const markFailedTerminal = vi.fn();

    const result = await sendNotificationEmailWithRetry({ emailSender: email.sender, markSent, markFailedTerminal, sleep: NO_WAIT }, "row-1", INPUT);

    expect(result).toEqual({ ok: true });
    expect(email.state.sentEmails).toHaveLength(2);
    expect(markFailedTerminal).not.toHaveBeenCalled();
  });

  it("exhausts exactly 3 attempts then marks failed with the real reason", async () => {
    const email = createFakeEmailSender({ behavior: () => ({ sent: false, failureReason: "outage" }) });
    const markSent = vi.fn();
    const markFailedTerminal = vi.fn();

    const result = await sendNotificationEmailWithRetry({ emailSender: email.sender, markSent, markFailedTerminal, sleep: NO_WAIT }, "row-1", INPUT);

    expect(result).toEqual({ ok: false, reason: "send_failed" });
    expect(email.state.sentEmails).toHaveLength(3);
    expect(markSent).not.toHaveBeenCalled();
    expect(markFailedTerminal).toHaveBeenCalledWith("row-1", "outage");
  });

  it("reuses the exact same input (idempotencyKey and payload) on every attempt — never regenerates between retries", async () => {
    const seenKeys: string[] = [];
    const email = createFakeEmailSender({
      behavior: (input, n) => {
        seenKeys.push(input.idempotencyKey);
        return n < 2 ? { sent: false, failureReason: "transient" } : undefined;
      },
    });

    await sendNotificationEmailWithRetry({ emailSender: email.sender, markSent: vi.fn(), markFailedTerminal: vi.fn(), sleep: NO_WAIT }, "row-1", INPUT);

    expect(new Set(seenKeys).size).toBe(1);
  });

  it("treats a provider replay of an already-accepted send (e.g. after a response timeout) as a clean success, same providerMessageId semantics", async () => {
    const email = createFakeEmailSender({
      behavior: (_input, callNumber) =>
        callNumber === 1 ? { sent: false, failureReason: "ETIMEDOUT" } : { sent: true, providerMessageId: "original-message-id" },
    });
    const markSent = vi.fn();

    const result = await sendNotificationEmailWithRetry({ emailSender: email.sender, markSent, markFailedTerminal: vi.fn(), sleep: NO_WAIT }, "row-1", INPUT);

    expect(result).toEqual({ ok: true });
    expect(markSent).toHaveBeenCalledWith("row-1", "original-message-id");
  });
});
