import type { ReactNode } from "react";
import Link from "next/link";
import { signOutAction } from "@/lib/admin/actions/auth-actions";
import { AdminUnauthorizedError, requireAdmin } from "@/lib/admin/require-admin";

const NAV_ITEMS = [
  { href: "/admin", label: "Schedule" },
  { href: "/admin/requests", label: "Requests" },
  { href: "/admin/cleaners", label: "Cleaners" },
  { href: "/admin/packages", label: "Packages" },
  { href: "/admin/availability", label: "Availability" },
];

/**
 * The real, DB-backed authorization gate for every /admin/* page except
 * /admin/login (which sits outside this route group). proxy.ts already
 * redirected any unauthenticated visitor away before this ever renders —
 * this is the secure re-check (see require-admin.ts's own doc comment on
 * why Proxy alone isn't sufficient). An authenticated-but-non-admin user
 * gets an inline "access denied" screen here, never a redirect loop.
 */
export default async function AdminProtectedLayout({ children }: { children: ReactNode }) {
  let unauthorized = false;
  try {
    await requireAdmin();
  } catch (error) {
    if (error instanceof AdminUnauthorizedError) {
      unauthorized = true;
    } else {
      throw error;
    }
  }

  if (unauthorized) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background-alt px-4">
        <div className="w-full max-w-sm rounded-2xl border border-border bg-surface p-8 text-center shadow-sm">
          <h1 className="text-lg font-semibold text-foreground">Access denied</h1>
          <p className="mt-2 text-sm text-muted">
            You&apos;re signed in, but this account doesn&apos;t have admin access to CleanPerfecto operations.
          </p>
          <form action={signOutAction} className="mt-6">
            <button
              type="submit"
              className="w-full rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-background-alt"
            >
              Sign out
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-background-alt">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-3">
          <div className="flex flex-wrap items-center gap-6">
            <span className="text-sm font-semibold text-foreground">CleanPerfecto Admin</span>
            <nav className="flex flex-wrap gap-1">
              {NAV_ITEMS.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="rounded-md px-3 py-1.5 text-sm font-medium text-muted hover:bg-background-alt hover:text-foreground"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
          <form action={signOutAction}>
            <button type="submit" className="text-sm font-medium text-muted hover:text-foreground">
              Sign out
            </button>
          </form>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">{children}</main>
    </div>
  );
}
