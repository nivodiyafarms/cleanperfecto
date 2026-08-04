export default function ServiceArea() {
  return (
    <section
      id="service-area"
      aria-labelledby="service-area-heading"
      className="px-6 py-10 sm:py-12 lg:px-8 lg:py-14"
    >
      <div className="mx-auto max-w-3xl text-center">
        <h2
          id="service-area-heading"
          className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl"
        >
          Proudly Serving DFW
        </h2>
        <p className="mt-4 text-lg text-muted">
          Serving Frisco, Plano, Lewisville, Richardson, McKinney, and
          nearby DFW communities. Contact us to confirm availability for
          your address.
        </p>
      </div>
    </section>
  );
}
