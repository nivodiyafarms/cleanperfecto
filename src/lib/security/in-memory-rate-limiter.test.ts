import { describe, expect, it } from "vitest";
import { createInMemoryRateLimiter } from "./in-memory-rate-limiter";

describe("createInMemoryRateLimiter", () => {
  it("allows up to maxAttempts inside the window and then blocks", () => {
    const limiter = createInMemoryRateLimiter({ windowMs: 1_000, maxAttempts: 3 });
    expect(limiter.take("ip:1", 100).allowed).toBe(true);
    expect(limiter.take("ip:1", 200).allowed).toBe(true);
    expect(limiter.take("ip:1", 300).allowed).toBe(true);
    expect(limiter.take("ip:1", 400).allowed).toBe(false);
  });

  it("isolates keys and slides the window", () => {
    const limiter = createInMemoryRateLimiter({ windowMs: 1_000, maxAttempts: 1 });
    expect(limiter.take("a", 0).allowed).toBe(true);
    expect(limiter.take("b", 0).allowed).toBe(true);
    expect(limiter.take("a", 500).allowed).toBe(false);
    expect(limiter.take("a", 1_001).allowed).toBe(true);
  });
});
