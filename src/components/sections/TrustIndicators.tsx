const INDICATORS = [
  { label: "Insured & Bonded", detail: "Every visit fully covered" },
  { label: "5.0 Average Rating", detail: "From verified customers" },
  { label: "Satisfaction Guarantee", detail: "We re-clean it if you're not happy" },
  { label: "Background-Checked Team", detail: "Vetted, trained cleaners" },
];

export default function TrustIndicators() {
  return (
    <section aria-label="Trust indicators" className="px-6 py-16 lg:px-8">
      <div className="mx-auto grid max-w-7xl grid-cols-2 gap-6 lg:grid-cols-4">
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
