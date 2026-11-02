import Link from "next/link";
import BrandLogo from "@/components/brand/BrandLogo";
import { PRIMARY_NAV_LINKS } from "@/lib/site-nav";

export default function SiteNav() {
  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-border bg-background/80 backdrop-blur-md">
      <nav
        aria-label="Primary"
        className="relative mx-auto flex max-w-7xl items-center justify-between gap-3 px-6 py-4 lg:px-8"
      >
        <a href="#hero">
          <BrandLogo id="cp-logo-nav" />
        </a>

        <div className="hidden items-center gap-8 text-sm text-muted lg:flex">
          {PRIMARY_NAV_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="transition-colors hover:text-foreground"
            >
              {link.label}
            </a>
          ))}
        </div>

        <details className="lg:hidden">
          <summary className="cursor-pointer list-none text-sm font-medium text-foreground">Menu</summary>
          <div className="absolute inset-x-0 top-full border-b border-border bg-background px-6 py-3">
            {PRIMARY_NAV_LINKS.map((link) => (
              <a key={link.href} href={link.href} className="block py-2 text-sm text-foreground">
                {link.label}
              </a>
            ))}
          </div>
        </details>

        <Link
          href="/quote"
          className="inline-flex min-h-11 items-center justify-center rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-secondary"
        >
          Get My Cleaning Quote
        </Link>
      </nav>
    </header>
  );
}
