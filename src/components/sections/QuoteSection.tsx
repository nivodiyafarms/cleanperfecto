import QuoteForm from "./QuoteForm";

export default function QuoteSection() {
  return (
    <section id="quote" className="px-6 py-24 lg:px-8">
      <div className="mx-auto max-w-3xl rounded-3xl border border-primary/30 bg-gradient-to-br from-primary/15 to-background-alt p-8 sm:p-12">
        <div className="text-center">
          <h2 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            Request your quote
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-lg text-muted">
            Tell us about your space and we&apos;ll follow up with pricing.
          </p>
          <p className="mx-auto mt-2 max-w-xl text-sm text-muted">
            Pricing depends on property size, condition, service type, and
            frequency.
          </p>
        </div>

        <div className="mt-10 rounded-3xl bg-white/80 p-6 backdrop-blur-sm sm:p-10">
          <QuoteForm />
        </div>
      </div>
    </section>
  );
}
