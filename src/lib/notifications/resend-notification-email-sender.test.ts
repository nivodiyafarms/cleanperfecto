import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sendMock = vi.fn();

vi.mock("resend", () => {
  class Resend {
    emails = { send: sendMock };
  }
  return { Resend };
});

const { createResendNotificationEmailSender } = await import("./resend-notification-email-sender");

describe("createResendNotificationEmailSender", () => {
  beforeEach(() => {
    sendMock.mockReset();
    sendMock.mockResolvedValue({ data: { id: "email_1" }, error: null });
    process.env.RESEND_API_KEY = "test-key";
  });

  afterEach(() => {
    delete process.env.RESEND_API_KEY;
  });

  it("passes the notification's own deterministic idempotency_key through as Resend's own idempotency key", async () => {
    const sender = createResendNotificationEmailSender();
    await sender.send({
      to: "jane@example.com",
      subject: "Your cleaning is confirmed",
      text: "text body",
      html: "<p>html body</p>",
      idempotencyKey: "visit-1:appointment_confirmed:email:2026-09-01T10:00:00.000Z",
    });

    expect(sendMock).toHaveBeenCalledTimes(1);
    const [, options] = sendMock.mock.calls[0];
    expect(options).toEqual({ idempotencyKey: "visit-1:appointment_confirmed:email:2026-09-01T10:00:00.000Z" });
  });

  it("reports sent:true with the provider message id on success", async () => {
    const sender = createResendNotificationEmailSender();
    const result = await sender.send({ to: "jane@example.com", subject: "s", text: "t", html: "<p>h</p>", idempotencyKey: "k" });
    expect(result).toEqual({ sent: true, providerMessageId: "email_1" });
  });

  it("reports sent:false without throwing when the provider returns an error", async () => {
    sendMock.mockResolvedValue({ data: null, error: { message: "invalid recipient", name: "validation_error" } });
    const sender = createResendNotificationEmailSender();
    const result = await sender.send({ to: "jane@example.com", subject: "s", text: "t", html: "<p>h</p>", idempotencyKey: "k" });
    expect(result.sent).toBe(false);
    expect(result.failureReason).toContain("invalid recipient");
  });

  it("reports sent:false without throwing when the send rejects", async () => {
    sendMock.mockRejectedValue(new Error("network error"));
    const sender = createResendNotificationEmailSender();
    const result = await sender.send({ to: "jane@example.com", subject: "s", text: "t", html: "<p>h</p>", idempotencyKey: "k" });
    expect(result).toEqual({ sent: false, failureReason: "network error" });
  });

  it("handles a missing RESEND_API_KEY without throwing", async () => {
    delete process.env.RESEND_API_KEY;
    const sender = createResendNotificationEmailSender();
    const result = await sender.send({ to: "jane@example.com", subject: "s", text: "t", html: "<p>h</p>", idempotencyKey: "k" });
    expect(sendMock).not.toHaveBeenCalled();
    expect(result.sent).toBe(false);
  });
});
