import { describe, expect, it } from "vitest";
import { buildCustomerContactRefreshPatch, type ExistingCustomerContact } from "./contact-refresh";

function existing(overrides: Partial<ExistingCustomerContact> = {}): ExistingCustomerContact {
  return {
    name: "Jane Customer",
    email: "jane@example.com",
    emailNormalized: "jane@example.com",
    phone: "+14695550100",
    phoneNormalized: "+14695550100",
    ...overrides,
  };
}

describe("buildCustomerContactRefreshPatch", () => {
  describe("dual match (email_and_phone) — both identifiers independently confirm the same customer", () => {
    it("refreshes name/email/phone from validated non-empty submitted values", () => {
      const patch = buildCustomerContactRefreshPatch({
        matchedBy: "email_and_phone",
        existingCustomer: existing({ name: "Old Name" }),
        name: "New Name",
        email: "new@example.com",
        emailNormalized: "new@example.com",
        phone: "469-555-9999",
        phoneNormalized: "+14695559999",
      });
      expect(patch).toEqual({
        name: "New Name",
        email: "new@example.com",
        emailNormalized: "new@example.com",
        phone: "469-555-9999",
        phoneNormalized: "+14695559999",
      });
    });
  });

  describe("email-only match", () => {
    it("refreshes email — the identifier that matched", () => {
      const patch = buildCustomerContactRefreshPatch({
        matchedBy: "email_only",
        existingCustomer: existing(),
        name: "Jane Customer",
        email: "new-address@example.com",
        emailNormalized: "new-address@example.com",
        phone: null,
        phoneNormalized: null,
      });
      expect(patch.email).toBe("new-address@example.com");
      expect(patch.emailNormalized).toBe("new-address@example.com");
    });

    it("does NOT overwrite a different existing non-null phone automatically", () => {
      const patch = buildCustomerContactRefreshPatch({
        matchedBy: "email_only",
        existingCustomer: existing({ phone: "+14695550100", phoneNormalized: "+14695550100" }),
        name: "Jane Customer",
        email: "jane@example.com",
        emailNormalized: "jane@example.com",
        phone: "469-555-9999",
        phoneNormalized: "+14695559999",
      });
      expect(patch).not.toHaveProperty("phone");
      expect(patch).not.toHaveProperty("phoneNormalized");
    });

    it("fills phone when the existing phone is currently null", () => {
      const patch = buildCustomerContactRefreshPatch({
        matchedBy: "email_only",
        existingCustomer: existing({ phone: null, phoneNormalized: null }),
        name: "Jane Customer",
        email: "jane@example.com",
        emailNormalized: "jane@example.com",
        phone: "469-555-9999",
        phoneNormalized: "+14695559999",
      });
      expect(patch.phone).toBe("469-555-9999");
      expect(patch.phoneNormalized).toBe("+14695559999");
    });

    it("does not replace a non-empty stored name merely because a single identifier matched", () => {
      const patch = buildCustomerContactRefreshPatch({
        matchedBy: "email_only",
        existingCustomer: existing({ name: "Existing Name" }),
        name: "A Different Name",
        email: "jane@example.com",
        emailNormalized: "jane@example.com",
        phone: null,
        phoneNormalized: null,
      });
      expect(patch).not.toHaveProperty("name");
    });

    it("fills a blank existing name", () => {
      const patch = buildCustomerContactRefreshPatch({
        matchedBy: "email_only",
        existingCustomer: existing({ name: "   " }),
        name: "New Name",
        email: "jane@example.com",
        emailNormalized: "jane@example.com",
        phone: null,
        phoneNormalized: null,
      });
      expect(patch.name).toBe("New Name");
    });
  });

  describe("phone-only match (symmetrical to email-only)", () => {
    it("refreshes phone — the identifier that matched", () => {
      const patch = buildCustomerContactRefreshPatch({
        matchedBy: "phone_only",
        existingCustomer: existing(),
        name: "Jane Customer",
        email: null,
        emailNormalized: null,
        phone: "469-555-9999",
        phoneNormalized: "+14695559999",
      });
      expect(patch.phone).toBe("469-555-9999");
      expect(patch.phoneNormalized).toBe("+14695559999");
    });

    it("does NOT overwrite a different existing non-null email automatically", () => {
      const patch = buildCustomerContactRefreshPatch({
        matchedBy: "phone_only",
        existingCustomer: existing({ email: "jane@example.com", emailNormalized: "jane@example.com" }),
        name: "Jane Customer",
        email: "different@example.com",
        emailNormalized: "different@example.com",
        phone: "+14695550100",
        phoneNormalized: "+14695550100",
      });
      expect(patch).not.toHaveProperty("email");
      expect(patch).not.toHaveProperty("emailNormalized");
    });

    it("fills email when the existing email is currently null", () => {
      const patch = buildCustomerContactRefreshPatch({
        matchedBy: "phone_only",
        existingCustomer: existing({ email: null, emailNormalized: null }),
        name: "Jane Customer",
        email: "new@example.com",
        emailNormalized: "new@example.com",
        phone: "+14695550100",
        phoneNormalized: "+14695550100",
      });
      expect(patch.email).toBe("new@example.com");
      expect(patch.emailNormalized).toBe("new@example.com");
    });

    it("does not replace a non-empty stored name merely because a single identifier matched", () => {
      const patch = buildCustomerContactRefreshPatch({
        matchedBy: "phone_only",
        existingCustomer: existing({ name: "Existing Name" }),
        name: "A Different Name",
        email: null,
        emailNormalized: null,
        phone: "+14695550100",
        phoneNormalized: "+14695550100",
      });
      expect(patch).not.toHaveProperty("name");
    });
  });

  describe("only one contact method supplied this submission", () => {
    it("updates only the safely matched contact field and erases nothing else", () => {
      const patch = buildCustomerContactRefreshPatch({
        matchedBy: "email_only",
        existingCustomer: existing({ phone: "+14695550100", phoneNormalized: "+14695550100" }),
        name: "Jane Customer",
        email: "jane@example.com",
        emailNormalized: "jane@example.com",
        phone: null,
        phoneNormalized: null,
      });
      expect(patch).toEqual({ email: "jane@example.com", emailNormalized: "jane@example.com" });
    });
  });

  it("returns an empty patch when nothing new was submitted", () => {
    const patch = buildCustomerContactRefreshPatch({
      matchedBy: "email_only",
      existingCustomer: existing(),
      name: "",
      email: null,
      emailNormalized: null,
      phone: null,
      phoneNormalized: null,
    });
    expect(patch).toEqual({});
  });

  it("trims the name before including it", () => {
    const patch = buildCustomerContactRefreshPatch({
      matchedBy: "email_and_phone",
      existingCustomer: existing(),
      name: "  Jane Customer  ",
      email: null,
      emailNormalized: null,
      phone: null,
      phoneNormalized: null,
    });
    expect(patch.name).toBe("Jane Customer");
  });
});
