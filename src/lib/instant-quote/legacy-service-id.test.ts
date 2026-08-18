import { describe, expect, it } from "vitest";
import { resolveLegacyServiceId } from "./legacy-service-id";

describe("resolveLegacyServiceId", () => {
  it("maps one_time standard to standard", () => {
    expect(resolveLegacyServiceId("standard", "one_time")).toBe("standard");
  });

  it("maps one_time deep to deep", () => {
    expect(resolveLegacyServiceId("deep", "one_time")).toBe("deep");
  });

  it("maps one_time move to move", () => {
    expect(resolveLegacyServiceId("move", "one_time")).toBe("move");
  });

  it("maps weekly (any cleaning type) to recurring", () => {
    expect(resolveLegacyServiceId("standard", "weekly")).toBe("recurring");
    expect(resolveLegacyServiceId("deep", "weekly")).toBe("recurring");
  });

  it("maps biweekly to recurring", () => {
    expect(resolveLegacyServiceId("standard", "biweekly")).toBe("recurring");
  });

  it("maps every_4_weeks to recurring", () => {
    expect(resolveLegacyServiceId("deep", "every_4_weeks")).toBe("recurring");
  });
});
