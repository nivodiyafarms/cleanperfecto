import Link from "next/link";
import type { ReactNode } from "react";
import { SITE_CONTACT } from "@/lib/site-contact";
import FirstCleaningOfferBadge from "./FirstCleaningOfferBadge";
import HeroVideoBackground from "./HeroVideoBackground";

function TagIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-5 w-5">
      <path
        d="M10.6 2.5H4.5A2 2 0 0 0 2.5 4.5v6.1c0 .53.21 1.04.586 1.414l6.9 6.9a2 2 0 0 0 2.828 0l5.286-5.286a2 2 0 0 0 0-2.828l-6.9-6.9A2 2 0 0 0 10.6 2.5Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <circle cx="7" cy="7" r="1.25" fill="currentColor" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-5 w-5">
      <rect
        x="2.75"
        y="4"
        width="14.5"
        height="13.25"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.4"
      />
      <path d="M2.75 8h14.5" stroke="currentColor" strokeWidth="1.4" />
      <path d="M6.5 2.5v3M13.5 2.5v3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function ShieldCheckIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-5 w-5">
      <path
        d="M10 2.5 4 4.75v4.6c0 4 2.6 6.9 6 8.15 3.4-1.25 6-4.15 6-8.15v-4.6L10 2.5Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path d="m7.25 10 1.9 1.9L12.75 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const BENEFITS: { icon: ReactNode; title: string; supporting: string }[] = [
  {
    icon: <TagIcon />,
    title: "Fixed Rate",
    supporting: "Available after your first service",
  },
  {
    icon: <CalendarIcon />,
    title: "Save 20%",
    supporting: "When scheduling 6+ recurring cleanings",
  },
  {
    icon: <ShieldCheckIcon />,
    title: "24-Hour Promise",
    supporting: "We return to make missed areas in scope right",
  },
];

export default function Hero() {
  return (
    <section
      id="hero"
      className="relative isolate overflow-hidden px-6 pt-28 pb-12 min-h-[700px] lg:flex lg:h-[88vh] lg:min-h-[760px] lg:items-center lg:px-8 lg:pt-8 lg:pb-8"
    >
      <HeroVideoBackground />

      <div className="relative mx-auto w-full max-w-7xl">
        <div className="max-w-xl text-left">
          <FirstCleaningOfferBadge nowIso={new Date().toISOString()} />

          <h1 className="mt-6 text-4xl font-semibold tracking-tight text-balance text-white sm:text-5xl lg:text-6xl">
            From lived-in to{" "}
            <span className="relative inline-block whitespace-nowrap">
              <span
                aria-hidden="true"
                className="absolute inset-x-0 bottom-1 h-3 rounded-sm bg-primary/50 sm:h-4"
              />
              <span className="relative">perfectly clean.</span>
            </span>
          </h1>

          <p className="mt-6 max-w-md text-lg text-white/85">
            Professional cleaning for homes, Airbnbs, offices, restaurants,
            and more across DFW.
          </p>

          <div className="mt-6 flex flex-col gap-3 sm:flex-row lg:mt-8">
            <Link
              href="/quote"
              className="inline-flex min-h-11 items-center justify-center rounded-full bg-primary px-8 py-3.5 text-base font-medium text-foreground transition-colors hover:bg-secondary lg:py-4"
            >
              Get My Cleaning Quote
            </Link>
            <a
              href={SITE_CONTACT.phoneHref}
              className="inline-flex min-h-11 items-center justify-center rounded-full border border-white/40 px-8 py-3.5 text-base font-medium text-white transition-colors hover:border-white hover:bg-white/10 lg:py-4"
            >
              Call or Text Us
            </a>
          </div>

          <div className="mt-6 grid gap-2 sm:grid-cols-3 lg:mt-8 lg:gap-3">
            {BENEFITS.map((benefit) => (
              <div
                key={benefit.title}
                className="flex items-start gap-2.5 rounded-xl bg-white/10 p-2.5 backdrop-blur-sm lg:p-3"
              >
                <span className="mt-0.5 shrink-0 text-primary">{benefit.icon}</span>
                <div>
                  <p className="text-sm font-semibold text-white">{benefit.title}</p>
                  <p className="mt-0.5 text-xs text-white/75">{benefit.supporting}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
