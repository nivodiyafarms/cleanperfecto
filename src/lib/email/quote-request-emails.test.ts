import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sendMock = vi.fn();

vi.mock("resend", () => {
  class Resend {
    emails = { send: sendMock };
  }
  return { Resend };
});

const { sendAdminQuoteRequestNotification, sendCustomerQuoteRequestEmail } = await import(
  "@/lib/email/quote-request-emails"
);

const BASE_DETAILS = {
  id: "11111111-1111-1111-1111-111111111111",
  createdAt: "2026-08-02T15:30:00.000Z",
  name: "Jane <Customer>",
  phone: "+1 (469) 555-0100",
  email: "jane@example.com",
  zip: "75067",
  propertyType: "home",
  serviceId: "deep",
  preferredDate: null,
  message: null,
};

describe("sendAdminQuoteRequestNotification", () => {
  beforeEach(() => {
    sendMock.mockReset();
    sendMock.mockResolvedValue({ data: { id: "email_1" }, error: null });
    process.env.RESEND_API_KEY = "test-key";
    process.env.QUOTE_NOTIFICATION_EMAILS =
      "admin1@example.com,admin2@example.com";
  });

  afterEach(() => {
    delete process.env.RESEND_API_KEY;
    delete process.env.QUOTE_NOTIFICATION_EMAILS;
  });

  it("sends one independent email per configured recipient", async () => {
    const summary = await sendAdminQuoteRequestNotification(BASE_DETAILS);

    expect(sendMock).toHaveBeenCalledTimes(2);
    expect(summary).toEqual({
      configured: true,
      attempted: 2,
      sent: 2,
      results: [
        { recipient: "admin1@example.com", sent: true },
        { recipient: "admin2@example.com", sent: true },
      ],
    });

    const recipients = sendMock.mock.calls.map((call) => call[0].to);
    expect(recipients).toEqual(["admin1@example.com", "admin2@example.com"]);

    // Each send targets exactly one recipient — no shared "to" list.
    for (const call of sendMock.mock.calls) {
      expect(typeof call[0].to).toBe("string");
    }
  });

  it("escapes customer-provided content in the HTML body", async () => {
    await sendAdminQuoteRequestNotification({
      ...BASE_DETAILS,
      name: "<script>alert(1)</script>",
      message: "Please clean the \"kitchen\" & bathroom",
    });

    const html = sendMock.mock.calls[0][0].html as string;
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&amp;");
    expect(html).toContain("&quot;kitchen&quot;");
  });

  it("includes the subject with property type and ZIP code", async () => {
    await sendAdminQuoteRequestNotification(BASE_DETAILS);
    const subject = sendMock.mock.calls[0][0].subject as string;
    expect(subject).toContain("Home");
    expect(subject).toContain("75067");
  });

  it("omits preferred date and message lines gracefully when absent", async () => {
    await sendAdminQuoteRequestNotification(BASE_DETAILS);
    const text = sendMock.mock.calls[0][0].text as string;
    expect(text).toContain("Preferred date: Not provided");
    expect(text).toContain("Message: Not provided");
  });

  it("includes preferred date and message when provided", async () => {
    await sendAdminQuoteRequestNotification({
      ...BASE_DETAILS,
      preferredDate: "2026-09-01",
      message: "Please focus on the kitchen.",
    });
    const text = sendMock.mock.calls[0][0].text as string;
    expect(text).toContain("Preferred date: 2026-09-01");
    expect(text).toContain("Message: Please focus on the kitchen.");
  });

  it("reports per-recipient failure without throwing when one send is rejected", async () => {
    sendMock
      .mockResolvedValueOnce({ data: { id: "email_1" }, error: null })
      .mockRejectedValueOnce(new Error("network error"));

    const summary = await sendAdminQuoteRequestNotification(BASE_DETAILS);

    expect(summary.attempted).toBe(2);
    expect(summary.sent).toBe(1);
    expect(summary.results).toEqual([
      { recipient: "admin1@example.com", sent: true },
      { recipient: "admin2@example.com", sent: false },
    ]);
  });

  it("treats a provider-returned error object as a failed send", async () => {
    sendMock
      .mockResolvedValueOnce({ data: null, error: { message: "invalid recipient" } })
      .mockResolvedValueOnce({ data: { id: "email_2" }, error: null });

    const summary = await sendAdminQuoteRequestNotification(BASE_DETAILS);

    expect(summary.sent).toBe(1);
    expect(summary.results[0].sent).toBe(false);
    expect(summary.results[1].sent).toBe(true);
  });

  it("does not attempt to send and reports unconfigured when QUOTE_NOTIFICATION_EMAILS is missing", async () => {
    delete process.env.QUOTE_NOTIFICATION_EMAILS;

    const summary = await sendAdminQuoteRequestNotification(BASE_DETAILS);

    expect(sendMock).not.toHaveBeenCalled();
    expect(summary).toEqual({ configured: false, attempted: 0, sent: 0, results: [] });
  });

  it("does not attempt to send when QUOTE_NOTIFICATION_EMAILS has no valid addresses", async () => {
    process.env.QUOTE_NOTIFICATION_EMAILS = "not-an-email, also-invalid";

    const summary = await sendAdminQuoteRequestNotification(BASE_DETAILS);

    expect(sendMock).not.toHaveBeenCalled();
    expect(summary.configured).toBe(false);
  });

  it("handles a missing RESEND_API_KEY without throwing", async () => {
    delete process.env.RESEND_API_KEY;

    const summary = await sendAdminQuoteRequestNotification(BASE_DETAILS);

    expect(sendMock).not.toHaveBeenCalled();
    expect(summary.configured).toBe(true);
    expect(summary.sent).toBe(0);
    expect(summary.results.every((result) => !result.sent)).toBe(true);
  });
});

// Not called from submitQuoteRequest.ts yet — these tests only verify the
// prepared template/config are correct ahead of activation approval.
describe("sendCustomerQuoteRequestEmail", () => {
  beforeEach(() => {
    sendMock.mockReset();
    sendMock.mockResolvedValue({ data: { id: "email_1" }, error: null });
    process.env.RESEND_API_KEY = "test-key";
  });

  afterEach(() => {
    delete process.env.RESEND_API_KEY;
  });

  it("sends to the customer's own email with the approved sender and reply-to", async () => {
    await sendCustomerQuoteRequestEmail(BASE_DETAILS);

    expect(sendMock).toHaveBeenCalledTimes(1);
    const call = sendMock.mock.calls[0][0];
    expect(call.to).toBe(BASE_DETAILS.email);
    expect(call.from).toBe("CleanPerfecto <support@cleanperfecto.com>");
    expect(call.replyTo).toBe("support@cleanperfecto.com");
    expect(call.subject).toBe("We received your CleanPerfecto quote request");
  });

  it("includes the same request reference UUID that was inserted into Supabase", async () => {
    await sendCustomerQuoteRequestEmail(BASE_DETAILS);

    const { text, html } = sendMock.mock.calls[0][0];
    expect(text).toContain(`Request reference: ${BASE_DETAILS.id}`);
    expect(html).toContain(BASE_DETAILS.id);
  });

  it("omits the preferred date line entirely when not provided", async () => {
    await sendCustomerQuoteRequestEmail({ ...BASE_DETAILS, preferredDate: null });

    const { text, html } = sendMock.mock.calls[0][0];
    expect(text).not.toContain("Preferred date");
    expect(html).not.toContain("Preferred date");
  });

  it("includes the preferred date line when provided", async () => {
    await sendCustomerQuoteRequestEmail({ ...BASE_DETAILS, preferredDate: "2026-09-01" });

    const { text, html } = sendMock.mock.calls[0][0];
    expect(text).toContain("Preferred date: 2026-09-01");
    expect(html).toContain("Preferred date:</strong> 2026-09-01");
  });

  it("never includes the customer message, pricing, or notification status", async () => {
    await sendCustomerQuoteRequestEmail({
      ...BASE_DETAILS,
      message: "Please do not share this with anyone",
    });

    const { text, html } = sendMock.mock.calls[0][0];
    expect(text).not.toContain("Please do not share this with anyone");
    expect(html).not.toContain("Please do not share this with anyone");
    expect(text.toLowerCase()).not.toContain("price");
    expect(text.toLowerCase()).not.toContain("supabase");
  });

  it("does not promise confirmed availability or final pricing", async () => {
    await sendCustomerQuoteRequestEmail(BASE_DETAILS);

    const { text } = sendMock.mock.calls[0][0];
    expect(text).toContain("Our team will review your request and contact you regarding availability and pricing.");
  });

  it("escapes customer-provided content in the HTML body", async () => {
    await sendCustomerQuoteRequestEmail({ ...BASE_DETAILS, name: "<script>alert(1)</script>" });

    const { html } = sendMock.mock.calls[0][0];
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("reports sent:false with a sanitized category without throwing when the provider rejects the send", async () => {
    sendMock.mockResolvedValue({ data: null, error: { message: "invalid recipient" } });

    const result = await sendCustomerQuoteRequestEmail(BASE_DETAILS);

    expect(result).toEqual({ sent: false, failureCategory: "provider_error" });
  });

  it("handles a missing RESEND_API_KEY without throwing", async () => {
    delete process.env.RESEND_API_KEY;

    const result = await sendCustomerQuoteRequestEmail(BASE_DETAILS);

    expect(sendMock).not.toHaveBeenCalled();
    expect(result).toEqual({ sent: false, failureCategory: "client_unavailable" });
  });
});
