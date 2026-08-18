import { describe, expect, it } from "vitest";
import { resolveSizeTier } from "./size-tier";

describe("resolveSizeTier", () => {
  it("maps 0 bedrooms to studio_1ba", () => {
    expect(resolveSizeTier(0)).toBe("studio_1ba");
  });

  it("maps negative bedrooms defensively to studio_1ba", () => {
    expect(resolveSizeTier(-1)).toBe("studio_1ba");
  });

  it("maps 1 bedroom to 1br_1ba", () => {
    expect(resolveSizeTier(1)).toBe("1br_1ba");
  });

  it("maps 2 bedrooms to 2br_2ba", () => {
    expect(resolveSizeTier(2)).toBe("2br_2ba");
  });

  it("maps 3 bedrooms to 3br_2ba", () => {
    expect(resolveSizeTier(3)).toBe("3br_2ba");
  });

  it("maps 4 bedrooms to 4br_plus", () => {
    expect(resolveSizeTier(4)).toBe("4br_plus");
  });

  it("maps bedroom counts above 4 to 4br_plus rather than inventing a new tier", () => {
    expect(resolveSizeTier(6)).toBe("4br_plus");
    expect(resolveSizeTier(10)).toBe("4br_plus");
  });
});
