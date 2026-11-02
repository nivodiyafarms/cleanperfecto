import { assertCapability, hasCapability, type AdminCapability } from "@/lib/admin/rbac/capabilities";

export const MANAGE_REFERRAL_PROGRAM: AdminCapability = "manage_referral_program";

export function canManageReferralProgram(role: string): boolean {
  return hasCapability(role, MANAGE_REFERRAL_PROGRAM);
}

export function assertCanManageReferralProgram(role: string): void {
  assertCapability(role, MANAGE_REFERRAL_PROGRAM);
}

export function creditVisibleToCustomer(beneficiaryCustomerId: string, viewerCustomerId: string): boolean {
  return beneficiaryCustomerId === viewerCustomerId;
}

export function referralVisibleToCustomer(input: {
  referredCustomerId: string;
  referrerCustomerId: string | null;
  viewerCustomerId: string;
}): boolean {
  return input.viewerCustomerId === input.referredCustomerId || input.viewerCustomerId === input.referrerCustomerId;
}
