import { describe, expect, it } from "vitest";
import type { InstantQuoteRawInput } from "./types";
import { validateInstantQuoteInput } from "./validate-input";

function validRawInput(overrides: Partial<InstantQuoteRawInput> = {}): InstantQuoteRawInput {
  return {
    propertyType: "home",
    cleaningType: "standard",
    condition: "light",
    rooms: { bedrooms: 1, fullBathrooms: 1, halfBathrooms: 0 },
    frequency: "one_time",
    isPrepaidPackage: false,
    visitCount: 1,
    addOnIds: [],
    name: "Jane Customer",
    phone: "469-555-0100",
    email: "jane@example.com",
    serviceAddress: { line1: "123 Main St", city: "Frisco", state: "TX", zip: "75056" },
    ...overrides,
  };
}

describe("validateInstantQuoteInput", () => {
  it("accepts a fully valid submission", () => {
    const result = validateInstantQuoteInput(validRawInput());
    expect(result.valid).toBe(true);
  });

  it("accepts phone-only contact", () => {
    const result = validateInstantQuoteInput(validRawInput({ email: undefined }));
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.value.email).toBeNull();
      expect(result.value.phone).toBe("469-555-0100");
    }
  });

  it("accepts email-only contact", () => {
    const result = validateInstantQuoteInput(validRawInput({ phone: undefined }));
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.value.phone).toBeNull();
    }
  });

  it("rejects when neither phone nor email is provided", () => {
    const result = validateInstantQuoteInput(validRawInput({ phone: undefined, email: undefined }));
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors).toContain("at least one contact method (email or phone) is required");
    }
  });

  it("rejects an invalid email", () => {
    const result = validateInstantQuoteInput(validRawInput({ email: "not-an-email" }));
    expect(result.valid).toBe(false);
  });

  it("rejects an invalid phone", () => {
    const result = validateInstantQuoteInput(validRawInput({ phone: "123" }));
    expect(result.valid).toBe(false);
  });

  it("rejects an unrecognized propertyType", () => {
    const result = validateInstantQuoteInput(
      validRawInput({ propertyType: "spaceship" as InstantQuoteRawInput["propertyType"] })
    );
    expect(result.valid).toBe(false);
  });

  it("rejects negative bedroom counts", () => {
    const result = validateInstantQuoteInput(
      validRawInput({ rooms: { bedrooms: -1, fullBathrooms: 1, halfBathrooms: 0 } })
    );
    expect(result.valid).toBe(false);
  });

  it("rejects a non-integer squareFeet", () => {
    const result = validateInstantQuoteInput(validRawInput({ squareFeet: 12.5 }));
    expect(result.valid).toBe(false);
  });

  it("accepts an omitted squareFeet as null", () => {
    const result = validateInstantQuoteInput(validRawInput());
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.value.squareFeet).toBeNull();
    }
  });

  it("rejects a malformed ZIP", () => {
    const result = validateInstantQuoteInput(
      validRawInput({ serviceAddress: { line1: "123 Main St", zip: "abc" } })
    );
    expect(result.valid).toBe(false);
  });

  it("accepts a ZIP+4", () => {
    const result = validateInstantQuoteInput(
      validRawInput({ serviceAddress: { line1: "123 Main St", zip: "75056-1234" } })
    );
    expect(result.valid).toBe(true);
  });

  it("rejects an unrecognized add-on id", () => {
    const result = validateInstantQuoteInput(
      validRawInput({ addOnIds: ["not_a_real_add_on"] as never })
    );
    expect(result.valid).toBe(false);
  });

  it("accepts approved add-on ids", () => {
    const result = validateInstantQuoteInput(validRawInput({ addOnIds: ["inside_oven"] }));
    expect(result.valid).toBe(true);
  });

  it("rejects an unrecognized add-on inside visitAddOns", () => {
    const result = validateInstantQuoteInput(
      validRawInput({ visitAddOns: [["not_a_real_add_on"] as never] })
    );
    expect(result.valid).toBe(false);
  });

  it("accepts valid visitAddOns", () => {
    const result = validateInstantQuoteInput(
      validRawInput({ visitAddOns: [["inside_oven"], [], ["inside_refrigerator"]] })
    );
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.value.visitAddOns).toEqual([["inside_oven"], [], ["inside_refrigerator"]]);
    }
  });

  it("rejects a malformed preferredDate", () => {
    const result = validateInstantQuoteInput(validRawInput({ preferredDate: "not-a-date" }));
    expect(result.valid).toBe(false);
  });

  it("rejects an impossible calendar date", () => {
    const result = validateInstantQuoteInput(validRawInput({ preferredDate: "2026-02-30" }));
    expect(result.valid).toBe(false);
  });

  it("accepts a valid preferredDate", () => {
    const result = validateInstantQuoteInput(validRawInput({ preferredDate: "2026-09-01" }));
    expect(result.valid).toBe(true);
  });

  it("rejects an unrecognized leadSource", () => {
    const result = validateInstantQuoteInput(
      validRawInput({ leadSource: "carrier_pigeon" as never })
    );
    expect(result.valid).toBe(false);
  });

  it("does not enforce the Standard+Extensive business rule — that is the pricing engine's job", () => {
    const result = validateInstantQuoteInput(
      validRawInput({ cleaningType: "standard", condition: "extensive" })
    );
    expect(result.valid).toBe(true);
  });

  it("collects multiple errors at once rather than stopping at the first", () => {
    const result = validateInstantQuoteInput(
      validRawInput({ name: "x", phone: undefined, email: "bad" })
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.length).toBeGreaterThan(1);
    }
  });
});
