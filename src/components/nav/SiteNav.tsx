import BrandLogo from "@/components/brand/BrandLogo";

const NAV_LINKS = [
  { href: "#services", label: "Services" },
  { href: "#how-it-works", label: "How it works" },
  { href: "#specializations", label: "Specializations" },
  { href: "#service-area", label: "Service area" },
];

export default function SiteNav() {
  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-border bg-background/80 backdrop-blur-md">
      <nav
        aria-label="Primary"
        className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4 lg:px-8"
      >
        <a href="#hero">
          <BrandLogo id="cp-logo-nav" />
        </a>

        <div className="hidden items-center gap-8 text-sm text-muted lg:flex">
          {NAV_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="transition-colors hover:text-foreground"
            >
              {link.label}
            </a>
          ))}
        </div>

        <a
          href="#quote"
          className="inline-flex min-h-11 items-center justify-center rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-secondary"
        >
          Get My Cleaning Quote
        </a>
      </nav>
    </header>
  );
}
