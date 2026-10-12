import { describe, expect, it } from "vitest";
import { sanitizeAuthConfirmErrorCode, sanitizeAuthConfirmErrorStatus } from "./sanitize-auth-confirm-error";

describe("sanitizeAuthConfirmErrorCode", () => {
  it("passes through a well-formed Supabase Auth error code unchanged", () => {
    expect(sanitizeAuthConfirmErrorCode({ code: "otp_expired" })).toBe("otp_expired");
  });

  it("falls back to a fixed label when code is absent, null, or empty — never silently drops the signal", () => {
    expect(sanitizeAuthConfirmErrorCode({ code: undefined })).toBe("unknown_error_code");
    expect(sanitizeAuthConfirmErrorCode({ code: null })).toBe("unknown_error_code");
    expect(sanitizeAuthConfirmErrorCode({ code: "" })).toBe("unknown_error_code");
    expect(sanitizeAuthConfirmErrorCode(null)).toBe("unknown_error_code");
    expect(sanitizeAuthConfirmErrorCode(undefined)).toBe("unknown_error_code");
  });

  it("rejects a code containing anything outside the closed lowercase/digit/underscore vocabulary, rather than trusting an unexpected SDK/server value", () => {
    expect(sanitizeAuthConfirmErrorCode({ code: "Token has expired or is invalid" })).toBe("unknown_error_code");
    expect(sanitizeAuthConfirmErrorCode({ code: "otp_expired; DROP TABLE x" })).toBe("unknown_error_code");
  });

  it("never passes through something that looks like a token, URL, or secret fragment even if it happened to land in the code field", () => {
    const serialized = sanitizeAuthConfirmErrorCode({ code: "https://evil.example.com/token_hash=abc123" });
    expect(serialized).toBe("unknown_error_code");
  });

  it("rejects an oversized string defensively, even if it were otherwise charset-valid", () => {
    const huge = "a".repeat(5000);
    expect(sanitizeAuthConfirmErrorCode({ code: huge })).toBe("unknown_error_code");
  });
});

describe("sanitizeAuthConfirmErrorStatus", () => {
  it("passes through a finite numeric status", () => {
    expect(sanitizeAuthConfirmErrorStatus({ status: 403 })).toBe(403);
  });

  it("falls back to 'unknown' for a missing or non-finite status", () => {
    expect(sanitizeAuthConfirmErrorStatus({ status: undefined })).toBe("unknown");
    expect(sanitizeAuthConfirmErrorStatus({ status: null })).toBe("unknown");
    expect(sanitizeAuthConfirmErrorStatus(null)).toBe("unknown");
    expect(sanitizeAuthConfirmErrorStatus({ status: Number.NaN })).toBe("unknown");
  });
});
