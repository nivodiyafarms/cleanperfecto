import HeroInteractive from "./HeroInteractive";

export default function Hero() {
  return (
    <section
      id="hero"
      className="relative overflow-hidden px-6 pt-32 pb-20 lg:px-8 lg:pt-44 lg:pb-28"
    >
      <div className="mx-auto grid max-w-7xl gap-16 lg:grid-cols-2 lg:items-center lg:gap-12">
        <div className="text-center sm:text-left">
          <h1 className="text-4xl font-semibold tracking-tight text-balance text-foreground sm:text-5xl lg:text-6xl">
            From lived-in to{" "}
            <span className="relative inline-block whitespace-nowrap">
              <span
                aria-hidden="true"
                className="absolute inset-x-0 bottom-1 h-3 rounded-sm bg-primary/40 sm:h-4"
              />
              <span className="relative">perfectly clean.</span>
            </span>
          </h1>
          <p className="mx-auto mt-6 max-w-md text-lg text-muted sm:mx-0">
            Choose your space, customize your cleaning, and book in minutes.
          </p>
          <div className="mt-10 flex justify-center sm:justify-start">
            <a
              href="#how-it-works"
              className="inline-flex w-full items-center justify-center rounded-full border border-border px-8 py-4 text-base font-medium text-foreground transition-colors hover:border-secondary/50 sm:w-auto"
            >
              See how it works
            </a>
          </div>
        </div>

        <HeroInteractive />
      </div>
    </section>
  );
}
