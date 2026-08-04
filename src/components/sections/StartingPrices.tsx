const PROPERTY_PRICING = [
  {
    label: "Studio / 1 Bath Apartment",
    standard: 109,
    deep: 169,
  },
  {
    label: "1 Bedroom / 1 Bath Apartment",
    standard: 129,
    deep: 199,
  },
  {
    label: "2 Bedroom / 2 Bath Apartment or Home",
    standard: 149,
    deep: 229,
  },
  {
    label: "3 Bedroom / 2 Bath Home",
    standard: 179,
    deep: 279,
  },
  {
    label: "4+ Bedrooms or Large Homes",
    standard: 209,
    deep: 329,
  },
];

const PRICED_ADD_ONS = [
  { label: "Inside Oven", price: "$35" },
  { label: "Inside Refrigerator", price: "$35" },
  { label: "Inside Cabinets and Drawers", price: "Starting at $40" },
  { label: "Pet Hair Treatment", price: "Starting at $20" },
  { label: "Interior Window Detailing", price: "Available by quote" },
];

const UNPRICED_ADD_ONS = ["Carpet Shampooing", "Heavy Organization"];

export default function StartingPrices() {
  return (
    <section
      aria-labelledby="pricing-heading"
      className="bg-background-alt px-6 pt-10 pb-8 sm:pt-12 sm:pb-10 lg:px-8 lg:pt-14 lg:pb-12"
    >
      <div className="mx-auto max-w-7xl">
        <div className="mx-auto max-w-2xl text-center">
          <h2
            id="pricing-heading"
            className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl"
          >
            Starting Prices
          </h2>
          <p className="mt-4 text-lg text-muted">
            Transparent starting rates to help you plan your cleaning.
          </p>
        </div>

        <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:mt-12 lg:grid-cols-3">
          {PROPERTY_PRICING.map((tier) => (
            <div
              key={tier.label}
              className="rounded-3xl border border-border bg-white p-6"
            >
              <h3 className="text-lg font-semibold text-foreground">{tier.label}</h3>
              <div className="mt-4 space-y-3">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-sm text-muted">Standard Cleaning</span>
                  <span className="text-lg font-semibold text-foreground whitespace-nowrap">
                    From ${tier.standard}
                  </span>
                </div>
                <div className="flex items-baseline justify-between gap-3 border-t border-border pt-3">
                  <span className="text-sm text-muted">Deep Cleaning</span>
                  <span className="text-lg font-semibold text-secondary whitespace-nowrap">
                    From ${tier.deep}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-6 rounded-3xl border border-primary/30 bg-gradient-to-br from-primary/10 to-transparent p-6 sm:p-8">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h3 className="text-lg font-semibold text-foreground">
              Move-In / Move-Out Cleaning
            </h3>
            <span className="text-lg font-semibold text-foreground whitespace-nowrap">
              From $199
            </span>
          </div>
          <p className="mt-2 text-sm text-muted">
            Based on property size, condition, and requested scope.
          </p>
        </div>

        <div className="mt-6 rounded-3xl border border-dashed border-border bg-white p-6 sm:p-8">
          <p className="text-sm font-semibold text-foreground">Popular Add-Ons</p>
          <ul className="mt-3 grid grid-cols-1 gap-x-6 gap-y-2 text-sm text-muted sm:grid-cols-2">
            {PRICED_ADD_ONS.map((addOn) => (
              <li key={addOn.label} className="flex items-baseline justify-between gap-3">
                <span>{addOn.label}</span>
                <span className="font-medium text-foreground whitespace-nowrap">
                  {addOn.price}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-sm text-muted">
            Also available as add-ons: {UNPRICED_ADD_ONS.join(", ")}.
          </p>
        </div>

        <p className="mx-auto mt-8 max-w-2xl text-center text-sm text-muted">
          Starting prices are estimates. Final pricing depends on property
          size, condition, cleaning type, requested scope, add-ons, and
          service frequency. Your final rate will be confirmed before
          service.
        </p>

        <div className="mt-8 flex justify-center">
          <a
            href="#quote"
            className="inline-flex min-h-11 items-center justify-center rounded-full bg-primary px-8 py-3.5 text-base font-medium text-foreground transition-colors hover:bg-secondary"
          >
            Get My Cleaning Quote
          </a>
        </div>
      </div>
    </section>
  );
}
