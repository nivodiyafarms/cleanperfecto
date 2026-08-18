import { describe, expect, it } from "vitest";
import { normalizeEmail } from "./normalize-email";

describe("normalizeEmail", () => {
  it("trims and lowercases", () => {
    expect(normalizeEmail(" Test@Email.COM ")).toBe("test@email.com");
  });

  it("leaves an already-normalized email unchanged", () => {
    expect(normalizeEmail("jane@example.com")).toBe("jane@example.com");
  });

  it("does not remove Gmail-style dots — intentionally not more aggressive than trim+lowercase", () => {
    expect(normalizeEmail("Jane.Doe@Gmail.com")).toBe("jane.doe@gmail.com");
  });

  it("collapses only leading/trailing whitespace, not internal characters", () => {
    expect(normalizeEmail("\t jane@example.com\n")).toBe("jane@example.com");
  });
});
