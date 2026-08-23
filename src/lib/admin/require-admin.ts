import "server-only";

import { redirect } from "next/navigation";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export interface AdminSession {
  adminUserId: string;
  supabaseUserId: string;
  role: string;
}

export type AdminSessionResult =
  | { status: "unauthenticated" }
  | { status: "unauthorized" }
  | { status: "authorized"; session: AdminSession };

/** Thrown by requireAdmin() when a Supabase Auth user is authenticated but has no active admin_users row — the caller renders an inline "access denied" screen (never a redirect loop; the user did authenticate legitimately). */
export class AdminUnauthorizedError extends Error {
  constructor(message = "You're signed in, but this account doesn't have admin access.") {
    super(message);
    this.name = "AdminUnauthorizedError";
  }
}

type AdminUserLookup = (supabaseUserId: string) => Promise<{ id: string; role: string } | null>;

/**
 * Resolves whether an already-authenticated Supabase user id is an active
 * admin — the authorization decision itself, independent of how the caller
 * looked it up. Takes the lookup as a parameter (rather than constructing
 * its own client) specifically so it can be unit-tested against a fake,
 * the same "inject the persistence seam" pattern used throughout
 * src/lib/scheduling/ — real Supabase Auth network calls are never
 * exercised in a test.
 */
export function resolveAdminSession(supabaseUserId: string | null, lookup: (supabaseUserId: string) => { id: string; role: string } | null): AdminSessionResult {
  if (!supabaseUserId) {
    return { status: "unauthenticated" };
  }
  const adminUser = lookup(supabaseUserId);
  if (!adminUser) {
    return { status: "unauthorized" };
  }
  return { status: "authorized", session: { adminUserId: adminUser.id, supabaseUserId, role: adminUser.role } };
}

/**
 * Looks up admin_users via the existing service-role admin client. An
 * authenticated-but-non-admin Supabase user has zero grant/RLS access to
 * query admin_users about themselves (same zero-policy convention as every
 * other table in this schema — see the migration), so this lookup can only
 * ever go through service-role, never the per-request auth client.
 */
async function findActiveAdminUserBySupabaseUserId(supabaseUserId: string): Promise<{ id: string; role: string } | null> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("admin_users")
    .select("id, role")
    .eq("supabase_user_id", supabaseUserId)
    .eq("active", true)
    .maybeSingle();
  if (error) {
    throw new Error(`[admin] admin_users lookup failed: ${error.message}`);
  }
  return data;
}

async function resolveAdminSessionForCurrentRequest(lookup: AdminUserLookup): Promise<AdminSessionResult> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser(); // never getSession() — that only decodes the cookie's JWT without revalidating against Supabase Auth's server.

  if (!user) {
    return { status: "unauthenticated" };
  }
  const adminUser = await lookup(user.id);
  if (!adminUser) {
    return { status: "unauthorized" };
  }
  return { status: "authorized", session: { adminUserId: adminUser.id, supabaseUserId: user.id, role: adminUser.role } };
}

/**
 * The real authorization gate — server-only, called at the top of every
 * admin Server Component (page/layout) and every admin server action.
 * Redirects to /admin/login if there's no authenticated Supabase user at
 * all; throws AdminUnauthorizedError if authenticated but not an active
 * admin. No caller ever trusts a client-side role flag instead of calling
 * this.
 */
export async function requireAdmin(): Promise<AdminSession> {
  const result = await resolveAdminSessionForCurrentRequest(findActiveAdminUserBySupabaseUserId);

  if (result.status === "unauthenticated") {
    redirect("/admin/login");
  }
  if (result.status === "unauthorized") {
    throw new AdminUnauthorizedError();
  }
  return result.session;
}
