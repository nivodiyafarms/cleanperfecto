import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getGoogleBusinessProfileConfig, googleBusinessProfileReviewsUrl, normalizeGoogleResourceId } from "./config";

const KEYS = [
  "GOOGLE_BUSINESS_PROFILE_CLIENT_ID",
  "GOOGLE_BUSINESS_PROFILE_CLIENT_SECRET",
  "GOOGLE_BUSINESS_PROFILE_REFRESH_TOKEN",
  "GOOGLE_BUSINESS_PROFILE_ACCOUNT_ID",
  "GOOGLE_BUSINESS_PROFILE_LOCATION_ID",
] as const;

describe("getGoogleBusinessProfileConfig", () => {
  const original: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of KEYS) {
      original[key] = process.env[key];
      delete process.env[key];
    }
  });
  afterEach(() => {
    for (const key of KEYS) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
  });

  it("returns null when every credential is unset — the real state until Google approval lands", () => {
    expect(getGoogleBusinessProfileConfig()).toBeNull();
  });

  it("returns null when only some credentials are set", () => {
    process.env.GOOGLE_BUSINESS_PROFILE_CLIENT_ID = "id";
    process.env.GOOGLE_BUSINESS_PROFILE_CLIENT_SECRET = "secret";
    expect(getGoogleBusinessProfileConfig()).toBeNull();
  });

  it("returns the full config only once all five values are set", () => {
    process.env.GOOGLE_BUSINESS_PROFILE_CLIENT_ID = "id";
    process.env.GOOGLE_BUSINESS_PROFILE_CLIENT_SECRET = "secret";
    process.env.GOOGLE_BUSINESS_PROFILE_REFRESH_TOKEN = "token";
    process.env.GOOGLE_BUSINESS_PROFILE_ACCOUNT_ID = "accounts/123";
    process.env.GOOGLE_BUSINESS_PROFILE_LOCATION_ID = "locations/456";

    expect(getGoogleBusinessProfileConfig()).toEqual({
      clientId: "id",
      clientSecret: "secret",
      refreshToken: "token",
      accountId: "123",
      locationId: "456",
    });
  });

  it("accepts bare account and location ids and normalizes them the same way", () => {
    process.env.GOOGLE_BUSINESS_PROFILE_CLIENT_ID = "id";
    process.env.GOOGLE_BUSINESS_PROFILE_CLIENT_SECRET = "secret";
    process.env.GOOGLE_BUSINESS_PROFILE_REFRESH_TOKEN = "token";
    process.env.GOOGLE_BUSINESS_PROFILE_ACCOUNT_ID = "123";
    process.env.GOOGLE_BUSINESS_PROFILE_LOCATION_ID = "456";

    expect(getGoogleBusinessProfileConfig()).toMatchObject({ accountId: "123", locationId: "456" });
  });

  it("returns null for a doubled prefix or any other malformed resource path", () => {
    process.env.GOOGLE_BUSINESS_PROFILE_CLIENT_ID = "id";
    process.env.GOOGLE_BUSINESS_PROFILE_CLIENT_SECRET = "secret";
    process.env.GOOGLE_BUSINESS_PROFILE_REFRESH_TOKEN = "token";
    process.env.GOOGLE_BUSINESS_PROFILE_ACCOUNT_ID = "accounts/accounts/123";
    process.env.GOOGLE_BUSINESS_PROFILE_LOCATION_ID = "456";
    expect(getGoogleBusinessProfileConfig()).toBeNull();

    process.env.GOOGLE_BUSINESS_PROFILE_ACCOUNT_ID = "123";
    process.env.GOOGLE_BUSINESS_PROFILE_LOCATION_ID = "locations/locations/456";
    expect(getGoogleBusinessProfileConfig()).toBeNull();

    process.env.GOOGLE_BUSINESS_PROFILE_LOCATION_ID = "accounts/456";
    expect(getGoogleBusinessProfileConfig()).toBeNull();
  });

  it("treats a blank/whitespace-only value the same as unset", () => {
    process.env.GOOGLE_BUSINESS_PROFILE_CLIENT_ID = "id";
    process.env.GOOGLE_BUSINESS_PROFILE_CLIENT_SECRET = "secret";
    process.env.GOOGLE_BUSINESS_PROFILE_REFRESH_TOKEN = "token";
    process.env.GOOGLE_BUSINESS_PROFILE_ACCOUNT_ID = "   ";
    process.env.GOOGLE_BUSINESS_PROFILE_LOCATION_ID = "locations/456";
    expect(getGoogleBusinessProfileConfig()).toBeNull();
  });
});

describe("normalizeGoogleResourceId", () => {
  it("accepts both the bare id and a single matching prefix", () => {
    expect(normalizeGoogleResourceId("123", "account")).toBe("123");
    expect(normalizeGoogleResourceId("accounts/123", "account")).toBe("123");
    expect(normalizeGoogleResourceId("  locations/456  ", "location")).toBe("456");
    expect(normalizeGoogleResourceId("456", "location")).toBe("456");
  });

  it("rejects doubled prefixes, the wrong prefix, and extra path segments", () => {
    expect(normalizeGoogleResourceId("accounts/accounts/123", "account")).toBeNull();
    expect(normalizeGoogleResourceId("locations/locations/456", "location")).toBeNull();
    expect(normalizeGoogleResourceId("locations/456", "account")).toBeNull();
    expect(normalizeGoogleResourceId("accounts/123/locations/456", "account")).toBeNull();
    expect(normalizeGoogleResourceId("accounts/", "account")).toBeNull();
    expect(normalizeGoogleResourceId("../123", "account")).toBeNull();
  });
});

describe("googleBusinessProfileReviewsUrl", () => {
  it("applies each prefix exactly once", () => {
    expect(googleBusinessProfileReviewsUrl("123", "456")).toBe("https://mybusiness.googleapis.com/v4/accounts/123/locations/456/reviews");
  });

  it("refuses to build a path from an already-prefixed or malformed id", () => {
    expect(googleBusinessProfileReviewsUrl("accounts/123", "456")).toBeNull();
    expect(googleBusinessProfileReviewsUrl("123", "locations/456")).toBeNull();
  });
});
