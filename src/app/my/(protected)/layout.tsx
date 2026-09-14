import type { ReactNode } from "react";
import Link from "next/link";
import { signOutAction } from "@/lib/customer-portal/actions/auth-actions";
import { requireCustomer } from "@/lib/customer-portal/require-customer";

const NAV_ITEMS = [
  { href: "/my", label: "Home" },
  { href: "/my/cleanings", label: "My Cleanings" },
  { href: "/my/package", label: "My Package" },
  { href: "/my/payments", label: "Payments" },
  { href: "/my/invoices", label: "Invoices" },
  { href: "/my/receipts", label: "Receipts" },
  { href: "/my/consent", label: "Consent" },
  { href: "/my/profile", label: "Profile" },
];

/**
 * The real, DB-backed authorization gate for every /my/* page except
 * /my/login and /my/activate (which sit outside this route group).
 * proxy.ts already redirected an unauthenticated visitor away before this
 * ever renders — requireCustomer() is the secure re-check, and also
 * redirects an authenticated-but-unlinked visitor to /my/activate (an
 * expected first-time state, never an inline error here).
 */
export default async function CustomerPortalLayout({ children }: { children: ReactNode }) {
  await requireCustomer();

  return (
    <div className="flex min-h-screen flex-col bg-background-alt">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-3">
          <div className="flex flex-wrap items-center gap-6">
            <span className="text-sm font-semibold text-foreground">My CleanPerfecto</span>
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
