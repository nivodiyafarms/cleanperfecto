export default function ServiceArea() {
  return (
    <section
      id="service-area"
      aria-labelledby="service-area-heading"
      className="px-6 py-20 lg:px-8"
    >
      <div className="mx-auto max-w-3xl text-center">
        <h2
          id="service-area-heading"
          className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl"
        >
          Proudly serving your area
        </h2>
        <p className="mt-4 text-lg text-muted">
          We&apos;re currently serving the greater metro area and expanding
          into surrounding suburbs. Reach out to confirm availability at your
          address.
        </p>
      </div>
    </section>
  );
}
