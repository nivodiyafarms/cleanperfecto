import { SITE_CONTACT } from "@/lib/site-contact";
import QuoteForm from "./QuoteForm";

export default function QuoteSection() {
  return (
    <section
      id="quote"
      className="px-6 pt-10 pb-16 sm:pt-12 sm:pb-20 lg:px-8 lg:pt-14 lg:pb-24"
    >
      <div className="mx-auto max-w-3xl rounded-3xl border border-primary/30 bg-gradient-to-br from-primary/15 to-background-alt p-8 sm:p-12">
        <div className="text-center">
          <h2 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            Request Your Quote
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-lg text-muted">
            Tell us about your space and we&apos;ll follow up with pricing.
          </p>
          <p className="mx-auto mt-2 max-w-xl text-sm text-muted">
            Pricing depends on property size, condition, service type, and
            frequency.
          </p>
          <p className="mx-auto mt-4 max-w-xl text-sm text-foreground">
            Prefer to talk? Call or text{" "}
            <a
              href={SITE_CONTACT.phoneHref}
              className="font-semibold text-foreground underline decoration-secondary decoration-2 underline-offset-2 transition-colors hover:text-secondary"
            >
              {SITE_CONTACT.phoneDisplay}
            </a>
          </p>
        </div>

        <div className="mt-10 rounded-3xl bg-white/80 p-6 backdrop-blur-sm sm:p-10">
          <QuoteForm />
        </div>
      </div>
    </section>
  );
}
