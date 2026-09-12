/**
 * Paths under /admin/:path* that Proxy must let an unauthenticated visitor
 * reach — mirrors the equivalent /my/login and /my/auth/callback exclusions
 * in src/proxy.ts. /admin/login is its own destination (redirecting it to
 * itself would loop); /admin/forgot-password initiates password recovery
 * and is inherently unauthenticated; /admin/auth/callback is the
 * password-recovery code-exchange route, unauthenticated by definition
 * until it runs. Every other /admin path, including /admin/reset-password,
 * stays behind Proxy's normal authenticated-session check.
 */
export function isPublicAdminPath(pathname: string): boolean {
  return (
    pathname === "/admin/login" ||
    pathname.startsWith("/admin/login/") ||
    pathname === "/admin/forgot-password" ||
    pathname.startsWith("/admin/forgot-password/") ||
    pathname.startsWith("/admin/auth/callback")
  );
}
