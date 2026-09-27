/**
 * Paths under /my/:path* that Proxy must let an unauthenticated visitor
 * reach — mirrors the equivalent /admin/login and /admin/auth/callback
 * exclusions in is-public-admin-path.ts. /my/login is its own destination
 * (redirecting it to itself would loop); /my/auth/callback is the
 * magic-link `code`-exchange route; /my/auth/confirm is the token_hash
 * verification route for the Final Total one-click email link (see
 * customer-auth-link.ts) — both auth routes are unauthenticated by
 * definition until they run, so neither can be gated by the session check
 * they're meant to satisfy.
 *
 * /my/auth/callback uses the same exact-path-or-real-subpath pattern as
 * /my/login (`=== path` or `startsWith(path + "/")`), NOT a bare
 * `startsWith("/my/auth/callback")` — a bare prefix would also match a
 * lookalike like /my/auth/callback-evil or /my/auth/callbackAnything,
 * neither of which is this route at all.
 *
 * /my/auth/confirm is listed as an EXACT path only (no subpath form) — it
 * takes no sub-routes, and deliberately does not exempt any other/future
 * /my/auth/* route that hasn't been individually reviewed. Every other /my
 * path, including /my/activate, /my/payments, and the rest of the customer
 * portal, stays behind Proxy's normal authenticated-session check.
 */
export function isPublicCustomerPath(pathname: string): boolean {
  return (
    pathname === "/my/login" ||
    pathname.startsWith("/my/login/") ||
    pathname === "/my/auth/callback" ||
    pathname.startsWith("/my/auth/callback/") ||
    pathname === "/my/auth/confirm"
  );
}
