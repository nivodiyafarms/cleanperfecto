import { describe, expect, it } from "vitest";
import { clientIpFromHeaderList } from "./client-ip-from-headers";

describe("clientIpFromHeaderList", () => {
  it("uses the first x-forwarded-for hop", () => {
    const headers = new Map([
      ["x-forwarded-for", "203.0.113.9, 10.0.0.1"],
      ["x-real-ip", "198.51.100.1"],
    ]);
    expect(clientIpFromHeaderList({ get: (name) => headers.get(name) ?? null })).toBe("203.0.113.9");
  });

  it("falls back to x-real-ip when forwarded-for is absent", () => {
    const headers = new Map([["x-real-ip", "198.51.100.7"]]);
    expect(clientIpFromHeaderList({ get: (name) => headers.get(name) ?? null })).toBe("198.51.100.7");
  });

  it("returns null when no client IP headers are present", () => {
    expect(clientIpFromHeaderList({ get: () => null })).toBeNull();
  });
});
