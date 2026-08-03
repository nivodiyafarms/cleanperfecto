import { beforeEach, describe, expect, it, vi } from "vitest";
import type { QuoteRequestPayload } from "@/lib/quote-request-types";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const insertMock = vi.fn();
const fromMock = vi.fn(() => ({ insert: insertMock }));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: vi.fn(() => ({ from: fromMock })),
}));

const sendAdminQuoteRequestNotification = vi.fn();
const sendCustomerQuoteRequestEmail = vi.fn();

// No real emails are sent by this suite — quote-request-emails is mocked
// entirely, so nothing here ever reaches Resend.
vi.mock("@/lib/email/quote-request-emails", () => ({
  sendAdminQuoteRequestNotification: (...args: unknown[]) =>
    sendAdminQuoteRequestNotification(...args),
  sendCustomerQuoteRequestEmail: (...args: unknown[]) => sendCustomerQuoteRequestEmail(...args),
}));

const { submitQuoteRequest } = await import("@/lib/submitQuoteRequest");

function validPayload(overrides: Partial<QuoteRequestPayload> = {}): QuoteRequestPayload {
  return {
    name: "Jane Customer",
    phone: "469-555-0100",
    email: "jane@example.com",
    zip: "75067",
    propertyType: "home",
    serviceId: "deep",
    preferredDate: "",
    message: "",
    ...overrides,
  };
}

describe("submitQuoteRequest", () => {
  beforeEach(() => {
    insertMock.mockReset();
    fromMock.mockClear();
    sendAdminQuoteRequestNotification.mockReset();
    sendAdminQuoteRequestNotification.mockResolvedValue({
      configured: true,
      attempted: 1,
      sent: 1,
      results: [],
    });
    sendCustomerQuoteRequestEmail.mockReset();
    sendCustomerQuoteRequestEmail.mockResolvedValue({ sent: true });
  });

  it("rejects an invalid payload before touching the database or sending any email", async () => {
    const result = await submitQuoteRequest(validPayload({ email: "not-an-email" }));

    expect(result.ok).toBe(false);
    expect(fromMock).not.toHaveBeenCalled();
    expect(sendAdminQuoteRequestNotification).not.toHaveBeenCalled();
    expect(sendCustomerQuoteRequestEmail).not.toHaveBeenCalled();
  });

  it("returns a failure and skips both email paths when the database insert errors", async () => {
    insertMock.mockResolvedValue({ error: { message: "insert failed" } });

    const result = await submitQuoteRequest(validPayload());

    expect(result.ok).toBe(false);
    expect(sendAdminQuoteRequestNotification).not.toHaveBeenCalled();
    expect(sendCustomerQuoteRequestEmail).not.toHaveBeenCalled();
  });

  // Regression test: submitQuoteRequest must never call .select() after
  // .insert() — service_role only has INSERT on quote_requests, and adding
  // a SELECT/RETURNING step previously made every submission fail with a
  // Postgres 42501 permission error (no row was ever saved). The mocked
  // insert here resolves to a plain { error } object with no `select`
  // method, so chaining `.select()` on it would throw and this test would
  // fail with result.ok === false.
  it("saves successfully and attempts both admin and customer email with a self-generated id and timestamp", async () => {
    insertMock.mockResolvedValue({ error: null });

    const result = await submitQuoteRequest(
      validPayload({ preferredDate: "2026-09-01", message: "Notes" })
    );

    expect(result).toEqual({ ok: true });
    expect(insertMock).toHaveBeenCalledTimes(1);

    const insertPayload = insertMock.mock.calls[0][0];
    expect(insertPayload.id).toMatch(UUID_PATTERN);
    expect(insertPayload).toMatchObject({
      name: "Jane Customer",
      phone: "469-555-0100",
      email: "jane@example.com",
      zip: "75067",
      property_type: "home",
      service_id: "deep",
      preferred_date: "2026-09-01",
      message: "Notes",
    });

    expect(sendAdminQuoteRequestNotification).toHaveBeenCalledTimes(1);
    expect(sendCustomerQuoteRequestEmail).toHaveBeenCalledTimes(1);

    const adminDetails = sendAdminQuoteRequestNotification.mock.calls[0][0];
    const customerDetails = sendCustomerQuoteRequestEmail.mock.calls[0][0];

    // Same UUID used for the database row, the admin email, and the
    // customer email.
    expect(adminDetails.id).toBe(insertPayload.id);
    expect(customerDetails.id).toBe(insertPayload.id);

    expect(adminDetails.createdAt).toEqual(expect.any(String));
    expect(new Date(adminDetails.createdAt).toString()).not.toBe("Invalid Date");
    expect(customerDetails.createdAt).toBe(adminDetails.createdAt);

    expect(customerDetails).toMatchObject({
      name: "Jane Customer",
      propertyType: "home",
      serviceId: "deep",
      preferredDate: "2026-09-01",
      message: "Notes",
    });
  });

  it("normalizes blank optional fields to null before notifying either recipient", async () => {
    insertMock.mockResolvedValue({ error: null });

    await submitQuoteRequest(validPayload({ preferredDate: "", message: "" }));

    expect(sendAdminQuoteRequestNotification).toHaveBeenCalledWith(
      expect.objectContaining({ preferredDate: null, message: null })
    );
    expect(sendCustomerQuoteRequestEmail).toHaveBeenCalledWith(
      expect.objectContaining({ preferredDate: null, message: null })
    );
  });

  it("still attempts the customer email and returns ok:true when admin notification rejects", async () => {
    insertMock.mockResolvedValue({ error: null });
    sendAdminQuoteRequestNotification.mockRejectedValue(new Error("resend down"));

    const result = await submitQuoteRequest(validPayload());

    expect(result).toEqual({ ok: true });
    expect(sendCustomerQuoteRequestEmail).toHaveBeenCalledTimes(1);
  });

  it("still attempts admin notification and returns ok:true when the customer email rejects", async () => {
    insertMock.mockResolvedValue({ error: null });
    sendCustomerQuoteRequestEmail.mockRejectedValue(new Error("resend down"));

    const result = await submitQuoteRequest(validPayload());

    expect(result).toEqual({ ok: true });
    expect(sendAdminQuoteRequestNotification).toHaveBeenCalledTimes(1);
  });

  it("returns ok:true when the customer email resolves sent:false", async () => {
    insertMock.mockResolvedValue({ error: null });
    sendCustomerQuoteRequestEmail.mockResolvedValue({
      sent: false,
      failureCategory: "provider_error",
    });

    const result = await submitQuoteRequest(validPayload());

    expect(result).toEqual({ ok: true });
  });

  it("attempts the customer email exactly once per submission", async () => {
    insertMock.mockResolvedValue({ error: null });

    await submitQuoteRequest(validPayload());

    expect(sendCustomerQuoteRequestEmail).toHaveBeenCalledTimes(1);
  });

  it("returns a failure when supabase admin client creation throws", async () => {
    const { createSupabaseAdminClient } = await import("@/lib/supabase/admin");
    vi.mocked(createSupabaseAdminClient).mockImplementationOnce(() => {
      throw new Error("Missing SUPABASE_SECRET_KEY");
    });

    const result = await submitQuoteRequest(validPayload());

    expect(result.ok).toBe(false);
    expect(sendAdminQuoteRequestNotification).not.toHaveBeenCalled();
    expect(sendCustomerQuoteRequestEmail).not.toHaveBeenCalled();
  });
});
