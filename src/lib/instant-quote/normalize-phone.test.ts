import { describe, expect, it } from "vitest";
import { normalizePhone } from "./normalize-phone";

describe("normalizePhone", () => {
  const approvedFormats = [
    "(469) 555-1234",
    "469-555-1234",
    "+1 469 555 1234",
    "1-469-555-1234",
    "4695551234",
    "14695551234",
  ];

  it.each(approvedFormats)("normalizes %s to +14695551234", (raw) => {
    expect(normalizePhone(raw)).toEqual({ valid: true, e164: "+14695551234" });
  });

  it("rejects a 9-digit number", () => {
    expect(normalizePhone("469-555-123")).toEqual({ valid: false });
  });

  it("rejects an 11-digit number not beginning with 1", () => {
    expect(normalizePhone("24695551234")).toEqual({ valid: false });
  });

  it("rejects a 12+ digit number rather than guessing at an international format", () => {
    expect(normalizePhone("+44 20 7946 0958")).toEqual({ valid: false });
  });

  it("rejects an empty string", () => {
    expect(normalizePhone("")).toEqual({ valid: false });
  });

  it("rejects non-numeric input", () => {
    expect(normalizePhone("not a phone number")).toEqual({ valid: false });
  });
});
