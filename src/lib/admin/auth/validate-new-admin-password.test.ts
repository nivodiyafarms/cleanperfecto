import { describe, expect, it } from "vitest";
import { validateNewAdminPassword } from "./validate-new-admin-password";

describe("validateNewAdminPassword", () => {
  it("rejects a password shorter than 8 characters", () => {
    const result = validateNewAdminPassword("short1", "short1");
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/at least 8 characters/);
  });

  it("rejects mismatched password and confirmation", () => {
    const result = validateNewAdminPassword("longenoughpassword", "differentpassword");
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/do not match/);
  });

  it("checks length before match, so a too-short mismatched pair reports the length error", () => {
    const result = validateNewAdminPassword("short", "evenshorterdiff");
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/at least 8 characters/);
  });

  it("accepts a valid, matching password of sufficient length", () => {
    const result = validateNewAdminPassword("longenoughpassword", "longenoughpassword");
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });
});
