import { describe, expect, it } from "vitest";
import { formatInvoiceDate, formatLineAmount } from "./InvoiceDocument";

describe("formatInvoiceDate", () => {
  it("returns an em dash for null", () => {
    expect(formatInvoiceDate(null)).toBe("—");
  });

  it("formats a bare calendar-date string (serviceDate) directly, with no timezone conversion", () => {
    expect(formatInvoiceDate("2026-10-14")).toBe("October 14, 2026");
  });

  it("converts a real UTC timestamptz (issueDate/voidAt) to America/Chicago before reading off the calendar date — the bug this fixes: an instant just after UTC midnight is still the PREVIOUS day in Central time", () => {
    // 2026-10-15T04:30:00Z = 2026-10-14 11:30 PM America/Chicago (CDT, UTC-5)
    const lateNightCentral = new Date("2026-10-15T04:30:00Z");
    expect(formatInvoiceDate(lateNightCentral)).toBe("October 14, 2026");
  });

  it("formats a UTC timestamptz that's unambiguously the same day in both UTC and Central time", () => {
    const midday = new Date("2026-10-14T18:00:00Z");
    expect(formatInvoiceDate(midday)).toBe("October 14, 2026");
  });
});

describe("formatLineAmount", () => {
  it("formats a positive amount the same as a plain charge", () => {
    expect(formatLineAmount(171.5)).toBe("$171.50");
  });

  it("formats a negative amount (a discount line) as -$X.XX, never $-X.XX", () => {
    expect(formatLineAmount(-25)).toBe("-$25.00");
  });

  it("formats zero as a plain positive-style amount", () => {
    expect(formatLineAmount(0)).toBe("$0.00");
  });
});
