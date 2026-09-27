/**
 * The single centralized admin authorization model. No admin action should
 * ever branch on `if (role === "...")` directly — every capability check
 * routes through `hasCapability`/`assertCapability` here, so the
 * owner/operations split can never drift out of sync between two call
 * sites.
 *
 * Legacy transition (Phase 2, owner-approved): the real production
 * admin_users rows have not yet been inspected, so the migration widening
 * `role`'s CHECK constraint (see supabase/migrations/
 * 20260907090000_widen_admin_users_role_for_rbac.sql) is purely additive —
 * it does NOT backfill any existing row. Every existing row is still
 * `'admin'`, the pre-RBAC V1 value. This module treats `'admin'` as
 * OWNER-EQUIVALENT for the duration of the transition specifically so no
 * currently-working admin access breaks the moment that migration is
 * applied. New rows should never be created with `role = 'admin'` going
 * forward — only `'owner_admin'` or `'operations'`. Phase 3 will inspect
 * the real production rows before deciding the eventual backfill/cleanup
 * of legacy `'admin'` rows.
 */

export type AdminRole = "admin" | "owner_admin" | "operations";

/** Raised when an authenticated admin lacks a specific capability — distinct from AdminUnauthorizedError (require-admin.ts), which means "not an admin at all." */
export class AdminForbiddenError extends Error {
  constructor(message = "Your admin role does not have permission to perform this action.") {
    super(message);
    this.name = "AdminForbiddenError";
  }
}

/**
 * Every capability this codebase currently has a real, callable admin
 * action for. Capabilities are named for the business action, not the
 * table/column they touch, so this list reads as a plain-language
 * permission catalog.
 */
export type AdminCapability =
  // Operations-permitted — routine customer/service operations.
  | "schedule_visit_operations" // confirm / reschedule / reassign / cancel a service visit
  | "complete_service_visit"
  | "record_external_payment" // ONLY through the existing frozen/system-derived amount flow — see record-external-payment.ts
  | "customer_portal_operations" // availability, cleaners, consent, notifications — routine admin-side operational actions
  // Owner-only — privileged financial/administrative actions.
  | "waive_fee" // explicitly listed as a "financial waiver/correction" — owner-only, never operations
  | "issue_refund" // no application-initiated refund action exists yet (refunds are webhook-reconciled only) — reserved for when one is built
  | "financial_correction" // owner-only financial correction — void invoice, and add/remove a custom charge/discount-credit (see finalize-send-actions.ts)
  | "override_tax" // reserved — no tax-override action exists yet; retryExternalTaxSync is NOT this, see the ambiguous-classification note in payment-actions.ts
  | "manage_roles" // reserved — no role-management UI exists yet
  | "manage_payment_configuration"; // reserved — PAYMENT_MODE/TAX_MODE/Stripe keys are env-configured, not admin-UI-configured, in this milestone

const OPERATIONS_CAPABILITIES: ReadonlySet<AdminCapability> = new Set<AdminCapability>([
  "schedule_visit_operations",
  "complete_service_visit",
  "record_external_payment",
  "customer_portal_operations",
]);

/** 'owner_admin' and the legacy 'admin' value are treated identically during the transition — see the module-level comment. */
export function isOwnerEquivalent(role: string): boolean {
  return role === "owner_admin" || role === "admin";
}

export function isOperations(role: string): boolean {
  return role === "operations";
}

/**
 * True if `role` may perform `capability`. Owner-equivalent roles can do
 * everything; operations can do only what's in OPERATIONS_CAPABILITIES;
 * any other/unrecognized role value fails closed to false rather than
 * guessing.
 */
export function hasCapability(role: string, capability: AdminCapability): boolean {
  if (isOwnerEquivalent(role)) return true;
  if (isOperations(role)) return OPERATIONS_CAPABILITIES.has(capability);
  return false;
}

/** The authoritative enforcement point — throws AdminForbiddenError (never silently no-ops) when the role lacks the capability. */
export function assertCapability(role: string, capability: AdminCapability): void {
  if (!hasCapability(role, capability)) {
    throw new AdminForbiddenError(`This action requires a capability ("${capability}") your admin role ("${role}") does not have.`);
  }
}
