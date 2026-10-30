import Link from "next/link";
import type { ReactNode } from "react";
import BrandLogo from "@/components/brand/BrandLogo";
import SiteFooter from "@/components/footer/SiteFooter";

export function LegalDocument({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <>
      <header className="border-b border-border bg-background">
        <nav aria-label="Primary" className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-6 py-4 lg:px-8">
          <Link href="/" aria-label="CleanPerfecto home">
            <BrandLogo id="cp-logo-legal" />
          </Link>
          <Link
            href="/quote"
            className="inline-flex min-h-11 items-center justify-center rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-secondary"
          >
            Get My Cleaning Quote
          </Link>
        </nav>
      </header>
      <main className="flex-1 bg-background px-6 py-12 sm:py-16 lg:px-8">
        <article className="mx-auto max-w-3xl">
          <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">{title}</h1>
          <p className="mt-4 text-base leading-relaxed text-muted">{description}</p>
          <div className="mt-10 space-y-10">{children}</div>
        </article>
      </main>
      <SiteFooter />
    </>
  );
}

export function LegalSection({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="space-y-3 text-base leading-relaxed text-foreground">
      <h2 id={id} className="text-xl font-semibold tracking-tight text-foreground">
        {title}
      </h2>
      {children}
    </section>
  );
}

export function LegalNotice({ children }: { children: ReactNode }) {
  return <p className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-relaxed text-amber-950">{children}</p>;
}
