import HeroInteractive from "@/components/hero/HeroInteractive";

export default function CleaningServiceSelector() {
  return (
    <section
      aria-labelledby="find-service-heading"
      className="px-6 pt-10 pb-8 sm:pt-12 sm:pb-10 lg:px-8 lg:pt-14 lg:pb-12"
    >
      <div className="mx-auto max-w-7xl">
        <div className="mx-auto max-w-2xl text-center">
          <h2
            id="find-service-heading"
            className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl"
          >
            Find the Right Cleaning Service
          </h2>
          <p className="mt-4 text-lg text-muted">
            Choose your property and service to see what&apos;s included.
          </p>
        </div>

        <div className="mt-10 flex justify-center lg:mt-12">
          <HeroInteractive />
        </div>
      </div>
    </section>
  );
}
