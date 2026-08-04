const INDICATORS = [
  {
    label: "Residential & Commercial Cleaning",
    detail: "Homes, Airbnbs, offices, restaurants, and more",
  },
  {
    label: "Serving DFW",
    detail: "Local cleaning across North Dallas communities",
  },
  {
    label: "24-Hour Make-It-Right Promise",
    detail: "We return for missed areas included in the agreed scope",
  },
  {
    label: "Scope Confirmed Before Service",
    detail: "Your service details and final rate are confirmed in advance",
  },
];

export default function TrustIndicators() {
  return (
    <section
      aria-label="Trust indicators"
      className="px-6 py-10 sm:py-12 lg:px-8 lg:py-14"
    >
      <div className="mx-auto grid max-w-7xl grid-cols-2 items-center gap-6 lg:grid-cols-4">
        {INDICATORS.map((item) => (
          <div key={item.label} className="text-center sm:text-left">
            <p className="text-base font-semibold text-foreground">
              {item.label}
            </p>
            <p className="mt-1 text-sm text-muted">{item.detail}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
