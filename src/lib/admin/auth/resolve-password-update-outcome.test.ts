import { describe, expect, it } from "vitest";
import { resolvePasswordUpdateOutcome } from "./resolve-password-update-outcome";

describe("resolvePasswordUpdateOutcome", () => {
  it("reports success when updateUser returns no error", () => {
    expect(resolvePasswordUpdateOutcome(null)).toEqual({ status: "success" });
  });

  it("reports the error message when updateUser fails", () => {
    expect(resolvePasswordUpdateOutcome({ message: "Auth session missing." })).toEqual({
      status: "error",
      message: "Auth session missing.",
    });
  });
});
