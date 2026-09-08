import { describe, expect, it } from "vitest";
import { AdminForbiddenError, assertCapability, hasCapability, isOperations, isOwnerEquivalent } from "./capabilities";

describe("isOwnerEquivalent / isOperations", () => {
  it("owner_admin and legacy admin are both owner-equivalent", () => {
    expect(isOwnerEquivalent("owner_admin")).toBe(true);
    expect(isOwnerEquivalent("admin")).toBe(true);
  });

  it("operations is not owner-equivalent", () => {
    expect(isOwnerEquivalent("operations")).toBe(false);
    expect(isOperations("operations")).toBe(true);
  });

  it("an unrecognized role is neither", () => {
    expect(isOwnerEquivalent("superadmin")).toBe(false);
    expect(isOperations("superadmin")).toBe(false);
  });
});

describe("hasCapability", () => {
  it("owner_admin has every capability", () => {
    expect(hasCapability("owner_admin", "waive_fee")).toBe(true);
    expect(hasCapability("owner_admin", "issue_refund")).toBe(true);
    expect(hasCapability("owner_admin", "financial_correction")).toBe(true);
    expect(hasCapability("owner_admin", "override_tax")).toBe(true);
    expect(hasCapability("owner_admin", "manage_roles")).toBe(true);
    expect(hasCapability("owner_admin", "manage_payment_configuration")).toBe(true);
    expect(hasCapability("owner_admin", "schedule_visit_operations")).toBe(true);
    expect(hasCapability("owner_admin", "record_external_payment")).toBe(true);
  });

  it("legacy admin remains transitionally owner-equivalent — every capability", () => {
    expect(hasCapability("admin", "waive_fee")).toBe(true);
    expect(hasCapability("admin", "manage_roles")).toBe(true);
    expect(hasCapability("admin", "issue_refund")).toBe(true);
  });

  it("operations has exactly the permitted operational capabilities", () => {
    expect(hasCapability("operations", "schedule_visit_operations")).toBe(true);
    expect(hasCapability("operations", "complete_service_visit")).toBe(true);
    expect(hasCapability("operations", "record_external_payment")).toBe(true);
    expect(hasCapability("operations", "customer_portal_operations")).toBe(true);
  });

  it("operations lacks every owner-only financial capability", () => {
    expect(hasCapability("operations", "waive_fee")).toBe(false);
    expect(hasCapability("operations", "issue_refund")).toBe(false);
    expect(hasCapability("operations", "financial_correction")).toBe(false);
    expect(hasCapability("operations", "override_tax")).toBe(false);
    expect(hasCapability("operations", "manage_roles")).toBe(false);
    expect(hasCapability("operations", "manage_payment_configuration")).toBe(false);
  });

  it("an unrecognized role has no capability at all — fails closed", () => {
    expect(hasCapability("superadmin", "schedule_visit_operations")).toBe(false);
    expect(hasCapability("", "record_external_payment")).toBe(false);
  });
});

describe("assertCapability", () => {
  it("does not throw when the role has the capability", () => {
    expect(() => assertCapability("operations", "record_external_payment")).not.toThrow();
    expect(() => assertCapability("owner_admin", "waive_fee")).not.toThrow();
  });

  it("throws AdminForbiddenError when operations attempts an owner-only financial capability", () => {
    expect(() => assertCapability("operations", "waive_fee")).toThrow(AdminForbiddenError);
    expect(() => assertCapability("operations", "issue_refund")).toThrow(AdminForbiddenError);
    expect(() => assertCapability("operations", "manage_roles")).toThrow(AdminForbiddenError);
  });

  it("throws for an unrecognized role attempting any capability", () => {
    expect(() => assertCapability("guest", "customer_portal_operations")).toThrow(AdminForbiddenError);
  });
});
