import Image from "next/image";
import { SERVICES } from "@/lib/services";
import { SITE_CONTACT } from "@/lib/site-contact";

export default function SiteFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-white/10 bg-foreground px-6 py-16 lg:px-8">
      <div className="mx-auto grid max-w-7xl gap-10 sm:grid-cols-3">
        <div>
          <div className="inline-flex rounded-2xl bg-white p-3">
            <Image
              src="/brand/cleanperfecto-logo-full.png"
              alt="CleanPerfecto — Where Clean Meets Perfection"
              width={988}
              height={952}
              className="h-20 w-auto sm:h-24"
            />
          </div>
          <p className="mt-4 max-w-xs text-sm text-background/70">
            Premium residential and commercial cleaning, booked in minutes.
          </p>
        </div>

        <div>
          <p className="text-sm font-medium text-background">Services</p>
          <ul className="mt-3 space-y-2">
            {SERVICES.map((service) => (
              <li key={service.id}>
                <a
                  href="#services"
                  className="text-sm text-background/70 transition-colors hover:text-background"
                >
                  {service.name}
                </a>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <p className="text-sm font-medium text-background">Contact</p>
          <ul className="mt-3 space-y-2 text-sm text-background/70">
            <li>
              <a
                href={SITE_CONTACT.phoneHref}
                className="transition-colors hover:text-background"
              >
                {SITE_CONTACT.phoneDisplay}
              </a>
            </li>
            <li>
              <a
                href={SITE_CONTACT.emailHref}
                className="transition-colors hover:text-background"
              >
                {SITE_CONTACT.email}
              </a>
            </li>
          </ul>
        </div>
      </div>

      <p className="mx-auto mt-12 max-w-7xl text-sm text-background/50">
        &copy; {year} CleanPerfecto. All rights reserved.
      </p>
    </footer>
  );
}
