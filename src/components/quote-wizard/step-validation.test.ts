import { describe, expect, it } from "vitest";
import { isStepOneValid, isStepTwoValid, validateStepOne, validateStepTwo } from "./step-validation";

describe("validateStepOne", () => {
  it("accepts a valid 5-digit ZIP", () => {
    expect(validateStepOne("75056")).toEqual({});
    expect(isStepOneValid("75056")).toBe(true);
  });

  it("accepts a ZIP+4", () => {
    expect(validateStepOne("75056-1234")).toEqual({});
  });

  it("rejects an empty ZIP", () => {
    expect(validateStepOne("")).toHaveProperty("zip");
    expect(isStepOneValid("")).toBe(false);
  });

  it("rejects a malformed ZIP", () => {
    expect(validateStepOne("abc")).toHaveProperty("zip");
    expect(validateStepOne("123")).toHaveProperty("zip");
  });

  it("tolerates surrounding whitespace", () => {
    expect(validateStepOne("  75056  ")).toEqual({});
  });
});

describe("validateStepTwo", () => {
  function validInput() {
    return {
      firstName: "Jane",
      phone: "469-555-0100",
      email: "jane@example.com",
      addressLine1: "123 Main St",
      city: "Frisco",
    };
  }

  it("accepts fully valid input", () => {
    expect(validateStepTwo(validInput())).toEqual({});
    expect(isStepTwoValid(validInput())).toBe(true);
  });

  it("accepts an omitted email — optional", () => {
    const input = { ...validInput(), email: "" };
    expect(validateStepTwo(input)).toEqual({});
  });

  it("requires a first name of at least 2 characters", () => {
    expect(validateStepTwo({ ...validInput(), firstName: "J" })).toHaveProperty("firstName");
    expect(validateStepTwo({ ...validInput(), firstName: "" })).toHaveProperty("firstName");
  });

  it("requires a phone number", () => {
    expect(validateStepTwo({ ...validInput(), phone: "" })).toHaveProperty("phone");
  });

  it("rejects an invalid phone number", () => {
    expect(validateStepTwo({ ...validInput(), phone: "123" })).toHaveProperty("phone");
  });

  it("rejects a malformed email when one is provided", () => {
    expect(validateStepTwo({ ...validInput(), email: "not-an-email" })).toHaveProperty("email");
  });

  it("requires a service address", () => {
    expect(validateStepTwo({ ...validInput(), addressLine1: "" })).toHaveProperty("addressLine1");
  });

  it("requires a city", () => {
    expect(validateStepTwo({ ...validInput(), city: "" })).toHaveProperty("city");
  });

  it("collects multiple errors at once", () => {
    const errors = validateStepTwo({ firstName: "", phone: "", email: "bad", addressLine1: "", city: "" });
    expect(Object.keys(errors)).toHaveLength(5);
  });
});
